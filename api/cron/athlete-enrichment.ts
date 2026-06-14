/**
 * Vercel Cron -> Phase 22 athlete enrichment.
 *
 * Runs daily at 11:00 UTC (5:00 AM MT). Two phases:
 *   1. Enrich recently-storied games with athlete names (10 games/tick).
 *   2. Emit People-desk profiles for athletes who've crossed the
 *      3-win threshold.
 *
 * Budget: 120s. Each MaxPreps page fetch is ~1s; 10 fetches = ~10s.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { enrichRecentGames, emitAthleteProfiles } from "../../server/learning/athlete-enrichment.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const out: any = { ok: true };
  try {
    const limit = Number(req.query.limit ?? 10);
    out.enrichment = await enrichRecentGames({ limit });
  } catch (err: any) {
    out.enrichmentError = String(err?.message ?? err);
  }
  try {
    out.profiles = await emitAthleteProfiles();
  } catch (err: any) {
    out.profilesError = String(err?.message ?? err);
  }
  res.json(out);
}
