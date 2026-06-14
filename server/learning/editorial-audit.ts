/**
 * Phase 17: editorial audit agent.
 *
 * Runs once a day and scans the recent stories window for issues a human
 * editor would catch on a re-read: duplicates, desk misroutes, broken
 * events, ugly headlines, undignified obits, mangled encodings.
 *
 * v1 is fully deterministic — no LLM calls. Everything is SQL + regex.
 * v2 can add a Gemini desk-sanity check for ambiguous routes (city vs.
 * business, etc.).
 *
 * Each check produces zero or more `Finding` records. Findings dedupe by
 * (kind, fingerprint) so re-runs only insert genuinely new issues.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../storage.js";
import type { InsertEditorialAudit } from "../../shared/schema.js";

// Window the audit looks at on each pass. Anything older has been seen
// many times — if it's wrong we already missed our shot.
const AUDIT_WINDOW_HOURS = 48;

// Trigram-similarity threshold for duplicate detection. Tuned to catch
// wire-service reposts ("AP: Trump signs bill" vs "Trump signs bill, AP
// reports") without flagging genuinely different stories that share a
// noun phrase. Re-tune after the first week.
const DUP_SIMILARITY = 0.55;

type Finding = Omit<InsertEditorialAudit, "status">;

function fp(parts: (string | number)[]): string {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
}

// ─── 1. Duplicate detection ────────────────────────────────────────────────
//
// Wire-service reposts and multi-source coverage of the same event are the
// most common dedupe target. We compare headlines using PostgreSQL's
// trigram similarity, scoped to the same city + 24h window so unrelated
// stories with similar headlines aren't lumped together.

async function checkDuplicates(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    WITH recent AS (
      SELECT id, headline, city_id, source_name, published_at
      FROM stories
      WHERE published_at >= (NOW() - INTERVAL '48 hours')::text
        AND mod_state <> 'rejected'
        AND is_synthesis = false
    )
    SELECT
      a.id  AS a_id,  a.headline AS a_headline, a.source_name AS a_source,
      b.id  AS b_id,  b.headline AS b_headline, b.source_name AS b_source,
      a.city_id,
      similarity(a.headline, b.headline) AS sim
    FROM recent a
    JOIN recent b ON a.id < b.id
    WHERE a.city_id IS NOT DISTINCT FROM b.city_id
      AND ABS(EXTRACT(EPOCH FROM (a.published_at::timestamptz - b.published_at::timestamptz))) < 86400
      AND similarity(a.headline, b.headline) >= ${DUP_SIMILARITY}
    ORDER BY sim DESC
    LIMIT 200
  `)) as unknown as Array<{
    a_id: number; a_headline: string; a_source: string;
    b_id: number; b_headline: string; b_source: string;
    city_id: number | null; sim: number;
  }>;

  // Roll pairwise matches into clusters via union-find so a 3-way duplicate
  // produces one finding, not three.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const meta = new Map<number, { headline: string; source: string }>();
  for (const r of rows) {
    union(r.a_id, r.b_id);
    meta.set(r.a_id, { headline: r.a_headline, source: r.a_source });
    meta.set(r.b_id, { headline: r.b_headline, source: r.b_source });
  }
  const clusters = new Map<number, number[]>();
  for (const id of Array.from(meta.keys())) {
    const root = find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(id);
  }

  const findings: Finding[] = [];
  for (const ids of Array.from(clusters.values())) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((a, b) => a - b);
    const sample = sorted
      .slice(0, 4)
      .map((id) => {
        const m = meta.get(id)!;
        return `- #${id} [${m.source}] ${m.headline}`;
      })
      .join("\n");
    findings.push({
      kind: "duplicate",
      severity: ids.length >= 3 ? "high" : "medium",
      title: `${ids.length} stories appear to cover the same event`,
      detail: sample,
      subjectStoryIds: sorted as any,
      suggestedAction:
        "Pick the strongest source as canonical and hide the others (mod_state='rejected'), or synthesize.",
      fingerprint: fp(sorted),
    });
  }
  return findings;
}

// ─── 2. Event integrity ────────────────────────────────────────────────────
//
// Things in stories with on_calendar=true must have a valid future starts_at
// and a venue. Anything that fails those is a misclassified event.

async function checkEventIntegrity(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    SELECT id, headline, starts_at, venue, city_id, on_calendar
    FROM stories
    WHERE on_calendar = true
      AND mod_state <> 'rejected'
      AND (
        starts_at IS NULL
        OR venue IS NULL
        OR venue = ''
        OR starts_at < NOW()::text
      )
    ORDER BY id DESC
    LIMIT 100
  `)) as unknown as Array<{
    id: number; headline: string; starts_at: string | null;
    venue: string | null; city_id: number | null;
  }>;

  return rows.map((r) => {
    const reasons: string[] = [];
    if (!r.starts_at) reasons.push("missing starts_at");
    if (!r.venue) reasons.push("missing venue");
    if (r.starts_at && r.starts_at < new Date().toISOString()) reasons.push("starts_at in the past");
    return {
      kind: "event_integrity" as const,
      severity: r.starts_at && r.starts_at < new Date().toISOString() ? "low" as const : "high" as const,
      title: `Calendar event "${r.headline}" failing integrity check`,
      detail: `Reasons: ${reasons.join(", ")}. starts_at=${r.starts_at ?? "NULL"}, venue=${r.venue ?? "NULL"}.`,
      subjectStoryIds: [r.id] as any,
      suggestedAction:
        r.starts_at && r.starts_at < new Date().toISOString()
          ? "Already past — flip on_calendar=false to drop from the calendar without deleting."
          : "Either supply the missing field or set on_calendar=false.",
      fingerprint: fp(["event", r.id]),
    };
  });
}

// ─── 3. Proofreading ───────────────────────────────────────────────────────
//
// Cheap regex checks for ugly mechanical issues: encoding artifacts, ALL
// CAPS headlines, trailing punctuation, double spaces, broken em-dashes.

const ENCODING_RE = /â€™|â€œ|â€\u009d|â€"|Ã©|Ã¨|Ã±|â‚¬|Â |\uFFFD/;
const ALL_CAPS_RE = /^[A-Z0-9\s\-:.,!?'"]{15,}$/;
const DOUBLE_SPACE_RE = /  /;
const TRAILING_PUNCT_RE = /[.!]$/;

async function checkProofreading(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    SELECT id, headline, summary
    FROM stories
    WHERE published_at >= (NOW() - INTERVAL '48 hours')::text
      AND mod_state <> 'rejected'
    ORDER BY id DESC
    LIMIT 500
  `)) as unknown as Array<{ id: number; headline: string; summary: string | null }>;

  const findings: Finding[] = [];
  for (const r of rows) {
    const issues: string[] = [];
    const checks: { name: string; hit: boolean }[] = [
      { name: "encoding-artifact-headline", hit: ENCODING_RE.test(r.headline) },
      { name: "encoding-artifact-summary", hit: !!r.summary && ENCODING_RE.test(r.summary) },
      { name: "all-caps-headline", hit: ALL_CAPS_RE.test(r.headline) && r.headline.length >= 20 },
      { name: "double-space-headline", hit: DOUBLE_SPACE_RE.test(r.headline) },
      { name: "trailing-punct-headline", hit: TRAILING_PUNCT_RE.test(r.headline) && !r.headline.endsWith("...") },
    ];
    for (const c of checks) {
      if (!c.hit) continue;
      issues.push(c.name);
      findings.push({
        kind: "proofreading" as const,
        severity: c.name.startsWith("encoding") ? "high" as const : "low" as const,
        title: `Proofread: ${c.name} on #${r.id}`,
        detail: `Headline: "${r.headline}"`,
        subjectStoryIds: [r.id] as any,
        suggestedAction:
          c.name.startsWith("encoding")
            ? "Re-decode the source feed as UTF-8 or hand-fix the row."
            : "Hand-fix the headline in the admin UI.",
        fingerprint: fp([c.name, r.id]),
      });
    }
  }
  return findings;
}

// ─── 4. Headline length (6-12 words editorial rule) ─────────────────────────
//
// Anything shorter than 4 words or longer than 14 is worth a look.
// Synthesized stories (ZooTown's own writing) get the strictest check;
// upstream sources we can't always control, so we just flag the worst.

async function checkHeadlineLength(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    SELECT id, headline, source_name, is_synthesis, is_obituary
    FROM stories
    WHERE published_at >= (NOW() - INTERVAL '48 hours')::text
      AND mod_state <> 'rejected'
      AND is_obituary = false
      AND on_calendar = false
    ORDER BY id DESC
    LIMIT 500
  `)) as unknown as Array<{
    id: number; headline: string; source_name: string;
    is_synthesis: boolean; is_obituary: boolean;
  }>;

  const findings: Finding[] = [];
  for (const r of rows) {
    const wordCount = r.headline.trim().split(/\s+/).length;
    let issue: string | null = null;
    if (r.is_synthesis) {
      if (wordCount < 5 || wordCount > 13) issue = `synthesis headline ${wordCount} words (target 6-12)`;
    } else {
      if (wordCount < 3 || wordCount > 18) issue = `upstream headline ${wordCount} words (extreme)`;
    }
    if (!issue) continue;
    findings.push({
      kind: "headline_length" as const,
      severity: r.is_synthesis ? "medium" as const : "low" as const,
      title: `Headline length: ${issue}`,
      detail: `#${r.id} (${r.source_name}): "${r.headline}"`,
      subjectStoryIds: [r.id] as any,
      suggestedAction: r.is_synthesis
        ? "Re-write to 6-12 words."
        : "Optional rewrite; upstream sources don't follow our style.",
      fingerprint: fp(["hl-len", r.id]),
    });
  }
  return findings;
}

// ─── 5. Obit dignity ────────────────────────────────────────────────────────
//
// Obits must carry the deceased's name in the headline, must not be
// truncated mid-sentence, and must come from a real obit source.

async function checkObitDignity(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    SELECT id, headline, summary, source_name
    FROM stories
    WHERE is_obituary = true
      AND published_at >= (NOW() - INTERVAL '48 hours')::text
      AND mod_state <> 'rejected'
    ORDER BY id DESC
    LIMIT 200
  `)) as unknown as Array<{ id: number; headline: string; summary: string | null; source_name: string }>;

  const findings: Finding[] = [];
  // Name detection accepts either "Firstname Lastname" or "Lastname, Firstname".
  // The comma-first format is the standard newspaper convention for obit
  // listings and is dignified — just different.
  const FORWARD_NAME = /[A-Z][a-z]+\s+[A-Z][a-z]+/;
  const REVERSED_NAME = /[A-Z][a-z]+,\s+[A-Z][a-z]+/;
  for (const r of rows) {
    const issues: string[] = [];
    if (!FORWARD_NAME.test(r.headline) && !REVERSED_NAME.test(r.headline)) {
      issues.push("no name detected in headline");
    }
    // Truncated body: ends with " " or "." cut at a word boundary mid-sentence.
    if (r.summary && r.summary.length > 50) {
      const tail = r.summary.trim().slice(-30);
      if (/[a-z],?\s+[a-z]+$/.test(tail)) issues.push("body appears truncated mid-sentence");
    }
    if (issues.length === 0) continue;
    findings.push({
      kind: "obit_dignity" as const,
      severity: "medium" as const,
      title: `Obit dignity: ${issues.join("; ")}`,
      detail: `#${r.id} (${r.source_name}): "${r.headline}"`,
      subjectStoryIds: [r.id] as any,
      suggestedAction: "Re-fetch verbatim from source or hide the row.",
      fingerprint: fp(["obit", r.id]),
    });
  }
  return findings;
}

// ─── 6. Desk misroute (simple heuristics, no LLM in v1) ────────────────────
//
// A few high-confidence rules: anything from an obit source not on the
// People desk, anything mentioning a Montana team win (already flagged by
// is_sports_recap=true) sitting outside desk=sports.

async function checkDeskMisroute(): Promise<Finding[]> {
  const rows = (await db.execute(sql`
    SELECT id, headline, desk, source_name, is_obituary, is_sports_recap, is_people_profile
    FROM stories
    WHERE published_at >= (NOW() - INTERVAL '48 hours')::text
      AND mod_state <> 'rejected'
      AND (
        (is_obituary = true AND desk <> 'people')
        OR (is_sports_recap = true AND desk <> 'sports')
        OR (is_people_profile = true AND desk NOT IN ('people','sports'))
      )
    ORDER BY id DESC
    LIMIT 200
  `)) as unknown as Array<{
    id: number; headline: string; desk: string;
    is_obituary: boolean; is_sports_recap: boolean; is_people_profile: boolean;
  }>;

  return rows.map((r) => {
    let expected = "people";
    if (r.is_sports_recap) expected = "sports";
    return {
      kind: "desk_misroute" as const,
      severity: "medium" as const,
      title: `#${r.id} classified as ${r.is_obituary ? "obit" : r.is_sports_recap ? "sports recap" : "profile"} but desk=${r.desk}`,
      detail: `"${r.headline}" — expected desk=${expected}`,
      subjectStoryIds: [r.id] as any,
      suggestedAction: `UPDATE stories SET desk='${expected}' WHERE id=${r.id};`,
      fingerprint: fp(["misroute", r.id, r.desk]),
    };
  });
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export interface AuditReport {
  duplicate: number;
  desk_misroute: number;
  event_integrity: number;
  proofreading: number;
  obit_dignity: number;
  headline_length: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
}

async function persist(findings: Finding[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const f of findings) {
    // INSERT ... ON CONFLICT DO NOTHING via the unique (kind, fingerprint)
    // index. Cheap and idempotent.
    const result = (await db.execute(sql`
      INSERT INTO editorial_audits (kind, severity, status, title, detail, subject_story_ids, suggested_action, fingerprint)
      VALUES (
        ${f.kind}, ${f.severity ?? "medium"}, 'open',
        ${f.title}, ${f.detail ?? null},
        ${sql.raw(`ARRAY[${(f.subjectStoryIds as unknown as number[]).join(",")}]::int[]`)},
        ${f.suggestedAction ?? null}, ${f.fingerprint}
      )
      ON CONFLICT (kind, fingerprint) DO NOTHING
      RETURNING id
    `)) as unknown as { id: number }[];
    if (result.length > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

export async function runEditorialAudit(): Promise<AuditReport> {
  const t0 = Date.now();
  const all: Finding[] = [];

  // Each check is independent — collect first, persist once.
  const checks: { name: keyof AuditReport; run: () => Promise<Finding[]> }[] = [
    { name: "duplicate", run: checkDuplicates },
    { name: "event_integrity", run: checkEventIntegrity },
    { name: "proofreading", run: checkProofreading },
    { name: "headline_length", run: checkHeadlineLength },
    { name: "obit_dignity", run: checkObitDignity },
    { name: "desk_misroute", run: checkDeskMisroute },
  ];

  const counts: Partial<AuditReport> = {};
  for (const c of checks) {
    try {
      const f = await c.run();
      counts[c.name] = f.length as any;
      all.push(...f);
    } catch (err: any) {
      console.error(`[editorial-audit] ${c.name} failed:`, err?.message ?? err);
      counts[c.name] = 0 as any;
    }
  }

  const { inserted, skipped } = await persist(all);
  return {
    duplicate: counts.duplicate ?? 0,
    desk_misroute: counts.desk_misroute ?? 0,
    event_integrity: counts.event_integrity ?? 0,
    proofreading: counts.proofreading ?? 0,
    obit_dignity: counts.obit_dignity ?? 0,
    headline_length: counts.headline_length ?? 0,
    totalInserted: inserted,
    totalSkipped: skipped,
    durationMs: Date.now() - t0,
  };
}
