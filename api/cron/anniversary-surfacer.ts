/**
 * Vercel Cron → Phase 16 daily anniversary surfacer.
 *
 * Runs once a day at 6 AM Mountain Time (= 12:00 UTC in standard time,
 * 13:00 UTC during DST — we set 12:00 UTC and accept the one-hour drift
 * in summer, when news still hasn't broken at 5 AM local).
 *
 * For each cron tick the runner:
 *   1. Picks profiles whose anniversary is today (Mountain) and surfaces
 *      them on the People desk.
 *   2. For each city, fills any People-desk drought with a fallback
 *      profile.
 *
 * Budget: 30 seconds. The work is O(profiles_today + cities) and well
 * under that.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnniversarySurfacer } from "../../server/learning/anniversary-surfacer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const report = await runAnniversarySurfacer();
    res.json({ ok: true, ...report });
  } catch (err: any) {
    console.error("[cron/anniversary-surfacer] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
