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
    // ---- X poll FIRST ----
    // The RSS source loop below can run long (60-source sequential fetch);
    // if Vercel times out at 60s, X must already be done. X is bounded at
    // ~5s (one API call + bounded DB writes), so it always finishes before
    // any RSS source is even started.
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

    // ---- RSS sources next ----
    // Bounded by a soft deadline so we never blow the 60s function limit.
    // Leave 5s of headroom before Vercel kills us; any source still pending
    // at that point gets skipped this tick and picked up on the next one.
    const STARTED_AT = Date.now();
    const SOFT_DEADLINE_MS = 50_000;
    const sources = (await storage.listSources()).filter((s) => dueNow(s, STARTED_AT));
    const results: Array<{ source: string; added: number; errors: number }> = [];
    let skippedForTime = 0;
    for (const s of sources) {
      if (Date.now() - STARTED_AT >= SOFT_DEADLINE_MS) {
        skippedForTime += 1;
        continue;
      }
      try {
        const summary = await ingestSource(s);
        results.push({ source: s.name, added: summary.added, errors: summary.errors });
      } catch (err: any) {
        results.push({ source: s.name, added: 0, errors: 1 });
      }
    }

    res.json({
      ok: true,
      checked: sources.length,
      processed: results.length,
      skippedForTime,
      results,
      x,
    });
  } catch (err: any) {
    console.error("[cron/ingest] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
