/**
 * One-shot Vercel endpoint to retire the Health desk.
 *
 * Hit with CRON_SECRET bearer. Optional ?dry_run=1 to preview without writes.
 * Optional ?limit=N to cap how many stories get processed in one run.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { retireHealthDesk } from "../../server/learning/health-retire.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const dryRun = req.query.dry_run === "1";
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  try {
    const report = await retireHealthDesk({ dryRun, limit });
    res.json({ ok: true, dryRun, ...report });
  } catch (err: any) {
    console.error("[cron/retire-health] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
