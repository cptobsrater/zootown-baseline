/**
 * Story-enrichment orchestrator (Phase 15).
 *
 * Runs the sports / people / obituary classifiers + the relevance scorer
 * against rows in `stories`. Two entry points:
 *
 *   classifyAndScore(storyId | row) -- update a single row's classifier
 *     outputs and score. Used by the ingester immediately after insert.
 *
 *   reclassifyRecent({ ageHours, limit }) -- pick up the N most recent
 *     stories without a classifier timestamp and process them. Used by
 *     the cron loop to catch anything the ingester missed (X signals,
 *     synthesis output, etc).
 *
 *   rescoreActive({ ageHours }) -- recompute relevance_score for every
 *     story published in the last `ageHours` window. This is the decay\n *     pass -- runs every ~15 min so wins/profiles slide down the feed\n *     naturally as time passes.
 */
import { storage, db } from "../storage.js";
import { stories } from "../../shared/schema.js";
import { eq, sql, isNull, gte } from "drizzle-orm";
import { classifySports } from "./sports-classifier.js";
import { classifyPeople } from "./people-classifier.js";
import { classifyObituary } from "./obituary-classifier.js";
import { scoreStory } from "./relevance-scorer.js";

interface StoryRow {
  id: number;
  headline: string;
  summary: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  publishedAt: string;
  desk: string | null;
  isSynthesis: boolean | null;
  onCalendar: boolean | null;
  startsAt: string | null;
  altDesks: string[] | null;
  sourceType?: string | null;
}

interface EnrichmentOutputs {
  isSportsRecap: boolean;
  sportsTeamsWon: string[];
  sportsTeamsLost: string[];
  sportsLevel: string | null;
  isPeopleProfile: boolean;
  peopleScope: string | null;
  peopleSubject: string | null;
  isObituary: boolean;
  relevanceScore: number;
  altDesks: string[];
}

/** Pure computation: classifiers + scorer, no DB writes. */
export function computeEnrichment(row: StoryRow): EnrichmentOutputs {
  const sports = classifySports({
    headline: row.headline,
    summary: row.summary,
    desk: row.desk,
  });
  const people = classifyPeople({
    headline: row.headline,
    summary: row.summary,
  });
  const obit = classifyObituary({
    headline: row.headline,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
  });

  const score = scoreStory({
    publishedAt: row.publishedAt,
    isSportsRecap: sports.isSportsRecap,
    hasLocalWin: sports.hasLocalWin,
    sportsLevel: sports.level,
    isPeopleProfile: people.isPeopleProfile,
    peopleScope: people.scope,
    isObituary: obit.isObituary,
    isSynthesis: !!row.isSynthesis,
    onCalendar: !!row.onCalendar,
    startsAt: row.startsAt,
    sourceType: row.sourceType,
  });

  // Cross-posting: if the story fires both sports + people (national-stage
  // MT athlete), it appears on both desks. Push the secondary desk into
  // alt_desks (the existing composite-feed mechanism) without losing any
  // alt_desks already on the row.
  const altDesks = new Set<string>(row.altDesks ?? []);
  const primaryDesk = row.desk;
  if (sports.isSportsRecap && primaryDesk !== "sports") altDesks.add("sports");
  if ((people.isPeopleProfile || obit.isObituary) && primaryDesk !== "people") altDesks.add("people");

  return {
    isSportsRecap: sports.isSportsRecap,
    sportsTeamsWon: sports.teamsWon,
    sportsTeamsLost: sports.teamsLost,
    sportsLevel: sports.level,
    isPeopleProfile: people.isPeopleProfile,
    peopleScope: people.scope,
    peopleSubject: people.subject,
    isObituary: obit.isObituary,
    relevanceScore: score.score,
    altDesks: Array.from(altDesks),
  };
}

async function applyEnrichment(id: number, e: EnrichmentOutputs): Promise<void> {
  await db
    .update(stories)
    .set({
      isSportsRecap: e.isSportsRecap,
      sportsTeamsWon: e.sportsTeamsWon,
      sportsTeamsLost: e.sportsTeamsLost,
      sportsLevel: (e.sportsLevel ?? null) as any,
      isPeopleProfile: e.isPeopleProfile,
      peopleScope: (e.peopleScope ?? null) as any,
      peopleSubject: e.peopleSubject,
      isObituary: e.isObituary,
      relevanceScore: e.relevanceScore,
      altDesks: e.altDesks,
      classifierAt: new Date().toISOString(),
    } as any)
    .where(eq(stories.id, id));
}

/**
 * Classify + score a single row. Used by the ingester right after a
 * fresh insert, so newly-landed stories already have their final score
 * and desk routing by the time they're rendered.
 */
export async function classifyAndScore(id: number): Promise<EnrichmentOutputs | null> {
  const rows = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
  if (!rows[0]) return null;
  const row = rows[0] as unknown as StoryRow;
  const out = computeEnrichment(row);
  await applyEnrichment(id, out);
  return out;
}

/**
 * Pick up unclassified rows (classifier_at IS NULL) in the last `ageHours`
 * and process them. Cap by `limit` per tick to bound cron latency.
 */
export async function reclassifyRecent(opts: { ageHours?: number; limit?: number } = {}): Promise<{ scanned: number; updated: number }> {
  const ageHours = opts.ageHours ?? 30 * 24; // 30 days
  const limit = opts.limit ?? 200;
  const sinceIso = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const rows = (await db.execute(sql`
    SELECT id, headline, summary, source_url AS "sourceUrl", source_name AS "sourceName",
           published_at AS "publishedAt", desk, is_synthesis AS "isSynthesis",
           on_calendar AS "onCalendar", starts_at AS "startsAt", alt_desks AS "altDesks",
           source_type AS "sourceType"
    FROM stories
    WHERE classifier_at IS NULL
      AND published_at >= ${sinceIso}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `)) as unknown as StoryRow[];

  let updated = 0;
  for (const row of rows) {
    const out = computeEnrichment(row);
    await applyEnrichment(row.id, out);
    updated++;
  }
  return { scanned: rows.length, updated };
}

/**
 * Re-score every story in the last `ageHours` window so the time-decay
 * curve stays accurate. Doesn't re-run the classifiers (those outputs
 * are stable once computed) -- it just recomputes the score from the
 * already-stored flags and the current clock.
 *
 * Cap at `limit` rows to bound latency, but in practice we want to cover
 * everything in the recent window. 2000 is plenty for a city-scale site.
 */
export async function rescoreActive(opts: { ageHours?: number; limit?: number } = {}): Promise<{ scanned: number; updated: number }> {
  const ageHours = opts.ageHours ?? 14 * 24; // two weeks
  const limit = opts.limit ?? 2000;
  const sinceIso = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const rows = (await db.execute(sql`
    SELECT id, published_at AS "publishedAt",
           is_sports_recap AS "isSportsRecap",
           sports_teams_won AS "sportsTeamsWon",
           sports_level AS "sportsLevel",
           is_people_profile AS "isPeopleProfile",
           people_scope AS "peopleScope",
           is_obituary AS "isObituary",
           is_synthesis AS "isSynthesis",
           on_calendar AS "onCalendar",
           starts_at AS "startsAt"
    FROM stories
    WHERE published_at >= ${sinceIso}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: number;
    publishedAt: string;
    isSportsRecap: boolean;
    sportsTeamsWon: string[];
    sportsLevel: string | null;
    isPeopleProfile: boolean;
    peopleScope: string | null;
    isObituary: boolean;
    isSynthesis: boolean | null;
    onCalendar: boolean | null;
    startsAt: string | null;
  }>;

  // Compute every score locally, then push the whole batch in ONE SQL
  // statement (UPDATE ... FROM (VALUES ...) AS v(id,score)). This is
  // ~100x faster than per-row UPDATE round-trips and lets us re-score
  // 2000+ rows comfortably inside a 60s cron.
  const tuples: Array<{ id: number; score: number }> = rows.map((r) => ({
    id: r.id,
    score: scoreStory({
      publishedAt: r.publishedAt,
      isSportsRecap: !!r.isSportsRecap,
      hasLocalWin: (r.sportsTeamsWon ?? []).length > 0,
      sportsLevel: (r.sportsLevel ?? null) as any,
      isPeopleProfile: !!r.isPeopleProfile,
      peopleScope: (r.peopleScope ?? null) as any,
      isObituary: !!r.isObituary,
      isSynthesis: !!r.isSynthesis,
      onCalendar: !!r.onCalendar,
      startsAt: r.startsAt,
    }).score,
  }));
  if (tuples.length === 0) return { scanned: 0, updated: 0 };
  // postgres-js parameter binding: build (id, score), (id, score), ...
  // We chunk to keep parameter count below Postgres' 65535 limit.
  const CHUNK = 1000;
  let updated = 0;
  for (let i = 0; i < tuples.length; i += CHUNK) {
    const chunk = tuples.slice(i, i + CHUNK);
    const idsArr = chunk.map((t) => t.id);
    const scoresArr = chunk.map((t) => t.score);
    await db.execute(sql`
      UPDATE stories AS s
         SET relevance_score = v.score
        FROM (
          SELECT UNNEST(${idsArr}::int[]) AS id,
                 UNNEST(${scoresArr}::double precision[]) AS score
        ) AS v
       WHERE s.id = v.id
    `);
    updated += chunk.length;
  }
  return { scanned: rows.length, updated };
}
