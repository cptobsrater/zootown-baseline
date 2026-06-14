/**
 * Vercel Cron -> story enrichment tick (Phase 15).
 *
 * Runs the sports/people/obituary classifiers against any rows that
 * haven't been classified yet, then bulk-recomputes relevance_score
 * across the active window so the time-decay curve stays accurate.
 *
 * Lives in its own endpoint (vs. bolted onto /api/cron/ingest) so the
 * 5-min ingest loop has its full 60s budget for the RSS + X + cluster +
 * synthesizer pipeline.
 *
 * Schedule: every 15 minutes. The classifier is idempotent (only touches
 * rows with classifier_at IS NULL); the scorer is also idempotent
 * (pure function of current row state + clock).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { reclassifyRecent, rescoreActive } from "../../server/learning/story-enrichment.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const out: { classifier?: any; rescore?: any; errors: string[] } = { errors: [] };
  try {
    out.classifier = await reclassifyRecent({ ageHours: 30 * 24, limit: 300 });
  } catch (err: any) {
    out.errors.push(`classifier: ${err?.message ?? err}`);
  }
  try {
    out.rescore = await rescoreActive({ ageHours: 14 * 24, limit: 5000 });
  } catch (err: any) {
    out.errors.push(`rescore: ${err?.message ?? err}`);
  }
  res.json({ ok: true, ...out });
}
