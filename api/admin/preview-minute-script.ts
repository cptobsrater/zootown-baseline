/**
 * Preview endpoint for the ZooTown Minute script generator.
 *
 * GET /api/admin/preview-minute-script
 *   Returns the script that would be generated right now using the current
 *   top-5 Missoula stories. Does NOT call HeyGen. Lets us iterate on the
 *   prompt cheaply.
 *
 * Auth: CRON_SECRET bearer (so we can curl it without admin token).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "drizzle-orm";
import { db } from "../../server/storage.js";
import {
  generateZootownMinuteScript,
  type ScriptStoryInput,
} from "../../server/learning/zootown-minute-script.js";

const MISSOULA_CITY_ID = 1;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    // Top 5 Missoula stories last 7 days, same scoring as /api/top-stories.
    const windowStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const rows = (await db.execute(sql`
      WITH draft_counts AS (
        SELECT story_id, COUNT(*)::int AS approved_drafts
        FROM story_drafts WHERE status = 'approved' AND source_of_change <> 'snapshot'
        GROUP BY story_id
      )
      SELECT
        s.id, s.headline, s.summary, s.source_name, s.source_url, s.published_at,
        COALESCE(sa.like_count, 0) - COALESCE(sa.dislike_count, 0)
          - (COALESCE(sa.report_count, 0) * 5)
          + (COALESCE(dc.approved_drafts, 0) * 3) AS score
      FROM stories s
      LEFT JOIN signal_aggregates sa ON sa.story_id = s.id
      LEFT JOIN draft_counts dc ON dc.story_id = s.id
      WHERE s.mod_state = 'approved'
        AND s.city_id = ${MISSOULA_CITY_ID}
        AND s.published_at > ${windowStart}
        AND s.desk NOT IN ('health')
      ORDER BY score DESC, published_at DESC
      LIMIT 5
    `)) as unknown as Array<{
      id: number; headline: string; summary: string | null;
      source_name: string; source_url: string;
      published_at: string; score: number;
    }>;

    if (rows.length === 0) {
      return res.status(200).json({ error: "no Missoula stories in last 7 days" });
    }

    const inputs: ScriptStoryInput[] = rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      summary: r.summary ?? "",
      source_name: r.source_name,
      source_url: r.source_url,
      published_at: r.published_at,
    }));

    const result = await generateZootownMinuteScript(inputs);

    res.json({
      stories: rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        source_name: r.source_name,
        source_url: r.source_url,
        score: r.score,
      })),
      script: result.script,
      word_count: result.word_count,
      estimated_seconds: result.estimated_seconds,
      target_window: { min: 215, max: 230, wpm: 150 },
      attributions: result.attributions,
      attempts_used: result.attempts,
      validator_warnings: result.warnings,
    });
  } catch (err: any) {
    console.error("[preview-minute-script]", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
