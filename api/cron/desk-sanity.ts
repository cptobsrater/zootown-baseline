/**
 * Vercel Cron -> Phase 21 Gemini desk sanity.
 *
 * Runs once a day at 13:00 UTC (7:00 MT) - 30 min after the editorial
 * audit pass, so Gemini sees yesterday's fresh stories.
 *
 * Budget: 120s. Each Gemini call is ~3-5s; 3 batches of 10 = ~15s. We
 * give ample headroom for occasional slow responses.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDeskSanity } from "../../server/learning/desk-sanity.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const limit = Number(req.query.limit ?? 30);
    const ageHours = Number(req.query.ageHours ?? 72);
    const report = await runDeskSanity({ limit, ageHours });
    res.json({ ok: true, ...report });
  } catch (err: any) {
    console.error("[cron/desk-sanity] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
