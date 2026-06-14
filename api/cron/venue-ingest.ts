/**
 * Vercel Cron -> curated venue ingest tick.
 *
 * Runs separately from /api/cron/ingest so the RSS/X/cluster/synthesis
 * loop doesn't get squeezed when venue HTTP fetches are slow. The venue
 * collector itself self-throttles to ~daily per venue via the
 * venue_ingest_runs table.
 *
 * Schedule: hourly. The 20h cooldown inside tickVenueIngest decides
 * which venues actually run each tick. This means we recover quickly
 * after an outage (next hour catches up) without piling load on venue
 * sites.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { tickVenueIngest } from "../../server/ingest/venues/venue-ingester.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const report = await tickVenueIngest();
    res.json({ ok: true, ...report });
  } catch (err: any) {
    console.error("[cron/venue-ingest] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
