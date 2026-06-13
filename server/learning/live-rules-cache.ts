/**
 * In-memory cache of live_rules for the ingest pipeline.
 *
 * The ingest hook (shouldSkipItem) runs hundreds of times per ingest cycle.
 * It cannot afford an async DB roundtrip per item, so we keep the active
 * rule set in process memory and refresh it periodically + on demand.
 *
 * Refresh strategy:
 *   - Lazy on first call (loads from DB the first time matchRules() is hit)
 *   - Time-based: re-fetch if the cache is older than REFRESH_MS
 *   - Manual: refreshLiveRules() can be called explicitly after an admin
 *     approves a proposed rule, so the next ingest tick uses it immediately
 *
 * Performance: even with thousands of rules this is fine in memory; rule
 * matching is O(N rules) per item but N is small (likely <100) and the
 * checks are cheap string ops.
 */
import { db } from "../storage.js";
import { liveRules } from "../../shared/schema.js";
import type { LiveRule, RuleMatchType } from "../../shared/schema.js";
import { eq, sql } from "drizzle-orm";

const REFRESH_MS = 5 * 60 * 1000; // refresh at most every 5 minutes

let cache: LiveRule[] = [];
let lastFetched = 0;
let inflight: Promise<void> | null = null;

async function fetchActiveRules(): Promise<void> {
  const rows = await db
    .select()
    .from(liveRules)
    .where(eq(liveRules.isActive, true));
  cache = rows as LiveRule[];
  lastFetched = Date.now();
}

/**
 * Manually force a refresh. Call this after approving / disabling a rule
 * so the next ingest item sees the change without waiting for REFRESH_MS.
 */
export async function refreshLiveRules(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetchActiveRules().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Run all active live_rules against (sourceName, sourceUrl, title).
 * Returns the FIRST matching rule's category (mapping to the skip reason),
 * or null if no rule matched. Categories mirror the reasoned-delete codes
 * so downstream logging stays consistent.
 *
 * Also bumps the matched rule's hits_lifetime counter asynchronously.
 * The bump is fire-and-forget so we don't slow ingest waiting on the
 * UPDATE -- if it fails, we lose a stat increment, no functional harm.
 */
export async function matchRules(input: {
  sourceName: string;
  sourceUrl: string | null;
  title: string;
}): Promise<{ rule: LiveRule; category: string } | null> {
  // Stale or empty? Refresh.
  if (cache.length === 0 || Date.now() - lastFetched > REFRESH_MS) {
    try {
      await refreshLiveRules();
    } catch (err) {
      // If the refresh fails, fall through with the stale cache; missing a
      // rule is far better than crashing the ingest cycle.
      console.error("[learning] refreshLiveRules failed:", err);
    }
  }

  if (cache.length === 0) return null;

  const titleLower = input.title.toLowerCase();
  const sourceDomain = extractDomain(input.sourceUrl);
  const url = input.sourceUrl ?? "";

  for (const r of cache) {
    if (!r.isActive) continue;
    if (matchOne(r.matchType, r.matchValue, {
      sourceName: input.sourceName,
      sourceDomain,
      url,
      title: input.title,
      titleLower,
    })) {
      bumpHitsAsync(r.id).catch(() => {});
      return { rule: r, category: r.category };
    }
  }
  return null;
}

function matchOne(
  matchType: RuleMatchType,
  matchValue: string,
  ctx: {
    sourceName: string;
    sourceDomain: string;
    url: string;
    title: string;
    titleLower: string;
  },
): boolean {
  switch (matchType) {
    case "source_name":
      return ctx.sourceName === matchValue;
    case "source_domain":
      return ctx.sourceDomain === matchValue.toLowerCase();
    case "url_regex":
      try {
        return new RegExp(matchValue).test(ctx.url);
      } catch {
        return false;
      }
    case "title_keyword":
      return ctx.titleLower.includes(matchValue.toLowerCase());
    case "title_regex":
      try {
        return new RegExp(matchValue).test(ctx.title);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function extractDomain(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function bumpHitsAsync(ruleId: number): Promise<void> {
  // Single UPDATE per match; cheap because there's no return value and the
  // server-side now() avoids a JS roundtrip for the timestamp.
  await db
    .update(liveRules)
    .set({
      hitsLifetime: sql`${liveRules.hitsLifetime} + 1` as any,
      lastHitAt: sql`now()` as any,
    })
    .where(eq(liveRules.id, ruleId));
}
