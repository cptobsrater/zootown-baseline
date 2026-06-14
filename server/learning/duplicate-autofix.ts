/**
 * Phase 20: auto-fix high-confidence duplicates.
 *
 * Runs after the duplicate detector. Promotes the EARLIER story in each
 * cluster as canonical; rejects the later one(s). Only acts when the
 * cluster meets all of:
 *   - All stories share the same source_name
 *   - All headlines share trigram similarity >= AUTOFIX_THRESHOLD
 *   - All stories published within AUTOFIX_WINDOW_HOURS of each other
 *   - None already rejected, pinned, or synthesis
 *
 * The hidden story's id goes into the canonical's synthesized_from_ids
 * so the audit trail is clear: "this story is the canonical for cluster
 * X, here's what it absorbed". The audit finding gets marked 'fixed'
 * with a note of the action taken.
 *
 * Conservative on purpose: cross-source dupes (NewsX vs AP wire) get
 * left for the admin because hiding one source is an editorial call,
 * not a mechanical one.
 */
import { sql } from "drizzle-orm";
import { db } from "../storage.js";

const AUTOFIX_THRESHOLD = 0.85;
const AUTOFIX_WINDOW_HOURS = 24;

interface DupRow {
  id: number;
  headline: string;
  source_name: string;
  published_at: string;
  city_id: number | null;
  mod_state: string;
  pinned_at: string | null;
  is_synthesis: boolean;
}

export interface AutofixReport {
  clustersExamined: number;
  clustersFixed: number;
  storiesHidden: number;
  storiesPromoted: number;
  skipped: { reason: string; auditId: number }[];
}

export async function autofixDuplicates(): Promise<AutofixReport> {
  const report: AutofixReport = {
    clustersExamined: 0,
    clustersFixed: 0,
    storiesHidden: 0,
    storiesPromoted: 0,
    skipped: [],
  };

  // Walk every open duplicate audit finding.
  const findings = (await db.execute(sql`
    SELECT id, subject_story_ids, severity
    FROM editorial_audits
    WHERE kind = 'duplicate'
      AND status = 'open'
    ORDER BY severity DESC, id ASC
    LIMIT 200
  `)) as unknown as { id: number; subject_story_ids: number[]; severity: string }[];

  for (const f of findings) {
    report.clustersExamined++;
    const ids = (f.subject_story_ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length < 2) continue;

    // Hydrate the cluster's stories.
    const rows = (await db.execute(
      sql.raw(`
        SELECT id, headline, source_name, published_at, city_id, mod_state,
               pinned_at, is_synthesis
        FROM stories
        WHERE id IN (${ids.join(",")})
        ORDER BY published_at ASC, id ASC
      `),
    )) as unknown as DupRow[];

    if (rows.length < 2) {
      report.skipped.push({ reason: "cluster shrank below 2 rows", auditId: f.id });
      continue;
    }

    // Eligibility gates.
    const allSameSource = rows.every((r) => r.source_name === rows[0].source_name);
    if (!allSameSource) {
      report.skipped.push({ reason: "mixed sources \u2014 admin decision", auditId: f.id });
      continue;
    }
    if (rows.some((r) => r.mod_state === "rejected" || r.pinned_at !== null || r.is_synthesis)) {
      report.skipped.push({ reason: "rejected/pinned/synthesis present", auditId: f.id });
      continue;
    }
    // Window check: max age spread.
    const times = rows.map((r) => Date.parse(r.published_at)).filter((n) => !isNaN(n));
    if (times.length !== rows.length) {
      report.skipped.push({ reason: "unparseable publish dates", auditId: f.id });
      continue;
    }
    const spreadH = (Math.max(...times) - Math.min(...times)) / 3_600_000;
    if (spreadH > AUTOFIX_WINDOW_HOURS) {
      report.skipped.push({ reason: `publish spread ${spreadH.toFixed(1)}h > ${AUTOFIX_WINDOW_HOURS}h`, auditId: f.id });
      continue;
    }
    // Similarity check (full pairwise).
    const similarityRows = (await db.execute(
      sql.raw(`
        SELECT MIN(similarity(a.headline, b.headline)) AS min_sim
        FROM stories a, stories b
        WHERE a.id IN (${ids.join(",")})
          AND b.id IN (${ids.join(",")})
          AND a.id < b.id
      `),
    )) as unknown as { min_sim: number }[];
    const minSim = Number(similarityRows[0]?.min_sim ?? 0);
    if (minSim < AUTOFIX_THRESHOLD) {
      report.skipped.push({ reason: `min similarity ${minSim.toFixed(2)} < ${AUTOFIX_THRESHOLD}`, auditId: f.id });
      continue;
    }

    // We're a go. Earliest story is canonical; reject the rest.
    const [canonical, ...losers] = rows;
    const loserIds = losers.map((r) => r.id);

    await db.execute(
      sql.raw(`
        UPDATE stories
        SET mod_state = 'rejected',
            reviewed_at = NOW()::text,
            is_reviewed = true
        WHERE id IN (${loserIds.join(",")})
      `),
    );

    // Append loser ids onto canonical's synthesized_from_ids so the
    // editorial trail records the merge. We DON'T set is_synthesis=true
    // because the canonical wasn't actually a multi-source synthesis \u2014
    // it just absorbed near-identical reposts.
    await db.execute(sql`
      UPDATE stories
      SET synthesized_from_ids = array_cat(synthesized_from_ids, ${loserIds as any}),
          is_reviewed = true,
          reviewed_at = NOW()::text
      WHERE id = ${canonical.id}
    `);

    // Mark the audit finding fixed with a note.
    const noteAction = `Auto-fixed: kept #${canonical.id}, rejected ${loserIds.map((i) => `#${i}`).join(", ")}.`;
    await db.execute(sql`
      UPDATE editorial_audits
      SET status = 'fixed',
          fixed_at = NOW(),
          suggested_action = ${noteAction}
      WHERE id = ${f.id}
    `);

    report.clustersFixed++;
    report.storiesPromoted++;
    report.storiesHidden += loserIds.length;
  }

  return report;
}
