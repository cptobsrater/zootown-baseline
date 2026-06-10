/**
 * Vercel Cron → ingest tick.
 * Schedule: every 5 minutes (see vercel.json).
 * Replaces the old `startScheduler()` setInterval that ran in dev.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storage } from "../../server/storage";
import { ingestSource } from "../../server/ingest/ingester";

function dueNow(s: any, now: number): boolean {
  if (!s.active) return false;
  if (!s.lastCheckedAt) return true;
  const last = Date.parse(s.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= s.cadenceMinutes * 60 * 1000;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel signs cron requests with the CRON_SECRET env var.
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const now = Date.now();
    const sources = (await storage.listSources()).filter((s) => dueNow(s, now));
    const results: Array<{ source: string; added: number; errors: number }> = [];
    for (const s of sources) {
      try {
        const summary = await ingestSource(s);
        results.push({ source: s.name, added: summary.added, errors: summary.errors });
      } catch (err: any) {
        results.push({ source: s.name, added: 0, errors: 1 });
      }
    }
    res.json({ ok: true, checked: sources.length, results });
  } catch (err: any) {
    console.error("[cron/ingest] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
