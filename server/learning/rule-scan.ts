/**
 * Pattern-scan engine for the "AI learns from your edits" loop.
 *
 * Inputs:
 *   - story_deletions rows from the last N days (default 14).
 *   - story_edits rows over the same window (for the contradiction signal).
 *
 * Output:
 *   - Zero or more proposed_rules rows (status='pending' or 'auto_promoted')
 *
 * Algorithm (intentionally simple and auditable):
 *
 * 1. Bucket every deletion by (sourceName, reasonCategory). Each bucket
 *    represents a candidate rule: "drop items from sourceName when they'd
 *    look like reasonCategory". We use sourceName because it's the most
 *    common signal in the corpus -- source-level rules cover the bulk of
 *    real-world cases (a chamber-of-commerce calendar reposting opinion
 *    pieces, a TV station that mirrors other-city content, etc.).
 *
 * 2. For each bucket count:
 *      hits             = number of deletions
 *      contradictions   = number of story_edits in the same window where
 *                         a story FROM THIS SOURCE had its modState bumped
 *                         from "rejected" back to "approved" by an admin.
 *                         (The admin disagreed with a previous block.)
 *
 * 3. Decide what to do with the bucket:
 *      hits >= 7 AND contradictions == 0   -> auto-promote (live + proposed)
 *      hits >= 3 AND contradictions <= 1   -> propose for review
 *      anything weaker                      -> ignore
 *
 * 4. Skip buckets whose (match, category) already exists in proposed_rules
 *    (status=pending) OR live_rules (is_active=true). The unique indexes on
 *    those tables would reject a duplicate insert, but checking first
 *    keeps the result clean.
 *
 * This is the single algorithm; the manual /admin/scan-rules endpoint and
 * the eventual Cloudflare Worker both call it.
 */
import { db } from "../storage.js";
import { storyDeletions, storyEdits, proposedRules, liveRules } from "../../shared/schema.js";
import type {
  StoryDeletionReason,
  RuleMatchType,
} from "../../shared/schema.js";
import { and, eq, gte, sql, inArray } from "drizzle-orm";

export interface ScanResult {
  scannedDeletions: number;
  buckets: number;
  proposed: number;
  autoPromoted: number;
  skipped: number;
  windowDays: number;
}

interface Bucket {
  sourceName: string;
  category: StoryDeletionReason;
  hitCount: number;
  contradictionCount: number;
  exampleStoryIds: number[];
}

const AUTO_PROMOTE_HITS = 7;
const AUTO_PROMOTE_MAX_CONTRA = 0;
const PROPOSE_HITS = 3;
const PROPOSE_MAX_CONTRA = 1;

/**
 * Run the full scan. Caller supplies the window and an optional admin id
 * for the auto-promotion provenance.
 */
export async function runRuleScan(opts: {
  windowDays?: number;
  reviewer?: string;
}): Promise<ScanResult> {
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 14, 90));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // ---- Step 1: load deletions in the window ----
  const deletions = await db
    .select({
      storyId: storyDeletions.storyId,
      sourceName: storyDeletions.sourceName,
      reasonCategory: storyDeletions.reasonCategory,
      deletedAt: storyDeletions.deletedAt,
    })
    .from(storyDeletions)
    .where(gte(storyDeletions.deletedAt, since));

  // ---- Step 2: bucket by (sourceName, reasonCategory) ----
  const buckets = new Map<string, Bucket>();
  for (const d of deletions) {
    // Some old story_deletions rows might have empty sourceName; skip them
    // because a rule keyed on "" matches nothing.
    if (!d.sourceName || d.sourceName.trim() === "") continue;
    // Skip the "other" category -- it's an admin-typed catch-all, never a
    // signal worth automating against.
    if (d.reasonCategory === "other") continue;
    const key = `${d.sourceName}\u0000${d.reasonCategory}`;
    const b = buckets.get(key);
    if (b) {
      b.hitCount += 1;
      // Keep at most 5 example IDs per bucket so the proposed row stays small.
      if (b.exampleStoryIds.length < 5) b.exampleStoryIds.push(d.storyId);
    } else {
      buckets.set(key, {
        sourceName: d.sourceName,
        category: d.reasonCategory as StoryDeletionReason,
        hitCount: 1,
        contradictionCount: 0,
        exampleStoryIds: [d.storyId],
      });
    }
  }

  // Early-out so we don't run a useless contradictions query.
  if (buckets.size === 0) {
    return {
      scannedDeletions: deletions.length,
      buckets: 0,
      proposed: 0,
      autoPromoted: 0,
      skipped: 0,
      windowDays,
    };
  }

  // ---- Step 3: contradictions per source ----
  // A "contradiction" is an admin edit that took modState from "rejected"
  // BACK to "approved" within the same window. That signals the admin
  // overrode a previous block, so we should weight this source's deletes
  // less heavily. We bucket by sourceName regardless of category since a
  // rescue is a rescue.
  const sourceNames = Array.from(new Set(Array.from(buckets.values()).map((b) => b.sourceName)));
  const edits = await db
    .select({
      sourceName: storyEdits.sourceName,
      field: storyEdits.field,
      afterValue: storyEdits.afterValue,
      beforeValue: storyEdits.beforeValue,
      editedAt: storyEdits.editedAt,
    })
    .from(storyEdits)
    .where(
      and(
        gte(storyEdits.editedAt, since),
        inArray(storyEdits.sourceName, sourceNames),
        eq(storyEdits.field, "modState"),
      ),
    );

  const contradictionsBySource = new Map<string, number>();
  for (const e of edits) {
    // storyEdits.sourceName is nullable in the schema; rows where the
    // edit hasn't been attributed to a source aren't useful evidence so
    // we skip them entirely.
    if (!e.sourceName) continue;
    if (e.beforeValue === "rejected" && e.afterValue === "approved") {
      const name = e.sourceName;
      contradictionsBySource.set(
        name,
        (contradictionsBySource.get(name) ?? 0) + 1,
      );
    }
  }
  // Array.from() to dodge the ES5 downlevel-iteration target -- same
  // workaround used in SponsorEditDialog.
  for (const b of Array.from(buckets.values())) {
    b.contradictionCount = contradictionsBySource.get(b.sourceName) ?? 0;
  }

  // ---- Step 4: skip what's already proposed/live ----
  const matchType: RuleMatchType = "source_name";
  const existingProposed = new Set<string>();
  const proposedRows = await db
    .select({
      matchValue: proposedRules.matchValue,
      category: proposedRules.category,
      status: proposedRules.status,
    })
    .from(proposedRules)
    .where(
      and(
        eq(proposedRules.matchType, matchType),
        eq(proposedRules.status, "pending"),
      ),
    );
  for (const r of proposedRows) existingProposed.add(`${r.matchValue}\u0000${r.category}`);

  const existingLive = new Set<string>();
  const liveRows = await db
    .select({
      matchValue: liveRules.matchValue,
      category: liveRules.category,
    })
    .from(liveRules)
    .where(
      and(eq(liveRules.matchType, matchType), eq(liveRules.isActive, true)),
    );
  for (const r of liveRows) existingLive.add(`${r.matchValue}\u0000${r.category}`);

  // ---- Step 5: insert ----
  let proposed = 0;
  let autoPromoted = 0;
  let skipped = 0;
  for (const b of Array.from(buckets.values())) {
    const key = `${b.sourceName}\u0000${b.category}`;
    if (existingLive.has(key) || existingProposed.has(key)) {
      skipped += 1;
      continue;
    }

    const auto =
      b.hitCount >= AUTO_PROMOTE_HITS && b.contradictionCount <= AUTO_PROMOTE_MAX_CONTRA;
    const propose = b.hitCount >= PROPOSE_HITS && b.contradictionCount <= PROPOSE_MAX_CONTRA;
    if (!auto && !propose) {
      skipped += 1;
      continue;
    }

    const status = auto ? "auto_promoted" : "pending";
    // Insert the proposed row first so we can FK-link the live row to it.
    const [insertedProposal] = await db
      .insert(proposedRules)
      .values({
        matchType,
        matchValue: b.sourceName,
        category: b.category,
        cityId: null,
        hitCount: b.hitCount,
        contradictionCount: b.contradictionCount,
        evidenceWindowDays: windowDays,
        exampleStoryIds: b.exampleStoryIds as any,
        status: status as any,
        reviewer: auto ? "auto-promote" : null,
        reviewedAt: auto ? new Date().toISOString() : null,
        reviewerNote: auto
          ? `Auto-promoted: ${b.hitCount} deletes, ${b.contradictionCount} contradictions in ${windowDays}d`
          : null,
      })
      .returning({ id: proposedRules.id });

    if (auto) {
      await db.insert(liveRules).values({
        matchType,
        matchValue: b.sourceName,
        category: b.category,
        cityId: null,
        source: "auto_promoted",
        proposedRuleId: insertedProposal.id,
        isActive: true,
      });
      autoPromoted += 1;
    } else {
      proposed += 1;
    }
  }

  return {
    scannedDeletions: deletions.length,
    buckets: buckets.size,
    proposed,
    autoPromoted,
    skipped,
    windowDays,
  };
}
