/**
 * Vercel Cron → ingest tick.
 * Schedule: every 5 minutes (see vercel.json).
 * Replaces the old `startScheduler()` setInterval that ran in dev.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storage, db } from "../../server/storage.js";
import { ingestSource } from "../../server/ingest/ingester.js";
import { pollXList, MONTANA_LIST_ID } from "../../server/ingest/x-fetcher.js";
import { processXSignals } from "../../server/ingest/x-signal-processor.js";
import { xListCursor } from "../../shared/schema.js";
import { eq } from "drizzle-orm";

function dueNow(s: any, now: number): boolean {
  if (!s.active) return false;
  if (!s.lastCheckedAt) return true;
  const last = Date.parse(s.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= s.cadenceMinutes * 60 * 1000;
}

/**
 * Decide whether to poll X this cron tick. Adaptive cadence matching the
 * dev-mode scheduler in server/ingest/ingester.ts:
 *   - 15 minutes during 07:00-23:00 Mountain Time (the active news window)
 *   - 60 minutes overnight
 *
 * Returns true iff age-since-last-poll >= the active cadence. The cron
 * itself fires every 5 minutes, so this gate prevents over-polling.
 */
async function xIsDue(): Promise<boolean> {
  if (!process.env.X_BEARER_TOKEN) return false;
  const rows = await db
    .select()
    .from(xListCursor)
    .where(eq(xListCursor.listId, MONTANA_LIST_ID));
  const cursor = rows[0];
  if (!cursor) return true; // no row yet -> poll to seed
  const lastMs = cursor.lastPolledAt ? Date.parse(cursor.lastPolledAt) : 0;
  const ageMin = (Date.now() - lastMs) / 60000;
  // Denver UTC offset ~6h (MDT) or 7h (MST). Treat 13:00-06:00 UTC as daytime.
  const utcHour = new Date().getUTCHours();
  const isDaytime = utcHour >= 13 || utcHour < 6;
  const cadenceMin = isDaytime ? 15 : 60;
  return ageMin >= cadenceMin;
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

    // X ingest runs on its own cadence (15min daytime / 60min overnight)
    // inside the same cron tick. xIsDue() checks last_polled_at; pollXList
    // does the API call + DB writes; processXSignals drains the resulting
    // tweet rows into placeholder stories.
    let x: {
      polled: boolean;
      reason?: string;
      tweetsFetched: number;
      newAuthors: number;
      monthlyUsage: number;
      signalsProcessed?: number;
      articlesFetched?: number;
    } | null = null;
    if (await xIsDue()) {
      try {
        const r = await pollXList();
        x = { ...r };
        if (r.polled) {
          const sig = await processXSignals();
          x.signalsProcessed = sig.processed;
          x.articlesFetched = sig.articlesFetched;
        }
      } catch (err: any) {
        console.error("[cron/ingest] X poll failed:", err);
        x = {
          polled: false,
          reason: String(err?.message ?? err),
          tweetsFetched: 0,
          newAuthors: 0,
          monthlyUsage: 0,
        };
      }
    }

    res.json({ ok: true, checked: sources.length, results, x });
  } catch (err: any) {
    console.error("[cron/ingest] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
