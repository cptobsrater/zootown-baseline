import type { Source } from "../../shared/schema.js";
import { storage } from "../storage.js";
import { rssFetcher } from "./rss.js";
import { htmlFetcher } from "./html.js";
import { headlessFetcher } from "./headless.js";
import { canonicalizeUrl, toInsertStory, shouldSkipItem } from "./normalize.js";
import { matchRules } from "../learning/live-rules-cache.js";
import { validateEventTime } from "../learning/event-time-validator.js";
import { classifyEvent } from "../learning/event-classifier.js";
import { pollXList } from "./x-fetcher.js";
import { processXSignals } from "./x-signal-processor.js";
import { applyClassificationRules, bumpHitCounts } from "./rules.js";
import type { FetchResult } from "./types.js";

export interface RunSummary {
  sourceId: number;
  sourceName: string;
  startedAt: string;
  finishedAt: string;
  mode: "live" | "mock" | "mixed";
  fetched: number;
  added: number;
  duplicates: number;
  clustered: number;
  errors: number;
  message: string | null;
  newStoryIds: number[];
}

const CLUSTER_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a date string like "Sat, May 3" or "May 3, 2026" into ISO. Returns undefined if unparseable. */
function parseEventDate(text: string | undefined, fallbackIso?: string): string | undefined {
  if (!text) return fallbackIso || undefined;
  // Try native Date first (handles "May 3, 2026", ISO, RFC2822)
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  // Match "<Mon>, May 3" or "May 3"
  const m = text.match(/(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+)?([A-Z][a-z]{2,8})\.?\s+(\d{1,2})(?:[,\s]+(\d{4}))?/i);
  if (!m) return fallbackIso || undefined;
  const monthKey = m[1].slice(0, 3).toLowerCase();
  const month = MONTHS[monthKey];
  if (month === undefined) return fallbackIso || undefined;
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  // If parsed date is more than a month in the past with no explicit year, bump to next year.
  if (!m[3]) {
    const candidate = new Date(year, month, day);
    if (candidate.getTime() < Date.now() - 30 * 24 * 3600 * 1000) year += 1;
  }
  const d = new Date(year, month, day, 19, 0, 0);
  return d.toISOString();
}

function extractVenue(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/(Wilma|Top\s*Hat|ELM|KettleHouse|Kettlehouse\s+Amphitheater|Monk['’]s\s+Bar|Stage\s*112|Big\s*Sky\s*Brewing|Caras\s+Park)/i);
  if (m) return m[0].replace(/\s+/g, " ").trim();
  return undefined;
}

async function runFetcher(source: Source): Promise<FetchResult> {
  if (source.feedType === "rss" || source.feedType === "atom") {
    return rssFetcher.fetch(source);
  }
  if (source.feedType === "html") {
    return htmlFetcher.fetch(source);
  }
  if (source.feedType === "headless") {
    return headlessFetcher.fetch(source);
  }
  return { mode: "mock", items: [], error: "no feed configured" };
}

export async function ingestSource(source: Source): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const newStoryIds: number[] = [];
  let added = 0;
  let duplicates = 0;
  let clustered = 0;
  let errors = 0;
  let mode: "live" | "mock" | "mixed" = "mock";
  let message: string | null = null;

  let result: FetchResult;
  try {
    result = await runFetcher(source);
    mode = result.mode;
    if (result.error) message = result.error;
  } catch (err: any) {
    errors++;
    result = { mode: "mock", items: [], error: err?.message ?? String(err) };
    message = result.error ?? null;
  }

  const fetched = result.items.length;
  const isCalendar = source.category === "calendars";
  // Calendar-category sources default to 'entertainment' (the live-music/shows/festivals desk).
  // Per-source override: the source's `desks` JSON array overrides if set.
  // Retired 'events' or unknown 'culture' fall back to 'entertainment'.
  let calendarDesk = "entertainment";
  if (isCalendar && source.desks) {
    try {
      const parsed = JSON.parse(source.desks);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        const candidate = parsed[0];
        if (candidate === "events" || candidate === "culture") {
          calendarDesk = "entertainment";
        } else {
          calendarDesk = candidate;
        }
      }
    } catch {
      // ignore
    }
  }

  for (const item of result.items) {
    try {
      if (!item.url || !item.title) continue;

      // Calendar-category sources route to the events table instead of stories.
      if (isCalendar) {
        const canonicalEv = canonicalizeUrl(item.url);
        if (await storage.findEventByUrl(canonicalEv)) {
          duplicates++;
          continue;
        }
        // Calendar events MUST have a real start time. If we can't parse one
        // from the summary/headline OR the feed-provided publishedAt, the
        // event is quarantined for human review instead of dropped silently.
        const parsedFromText = parseEventDate(item.summary, undefined)
          ?? parseEventDate(item.title, undefined);
        // Only trust publishedAt as a fallback if it's in the future (i.e. the
        // feed is signaling event start time via pubDate, common for iCal/event
        // RSS like Ticketmaster). Past publishedAt = article-style content, skip.
        let startsAt: string | undefined = parsedFromText;
        if (!startsAt && item.publishedAt) {
          const t = Date.parse(item.publishedAt);
          if (Number.isFinite(t) && t > Date.now() - 24 * 3600 * 1000) {
            startsAt = new Date(t).toISOString();
          }
        }

        // Strict validation: red-flag wording (TBD/see website/etc.),
        // midnight fallback, past dates, or no parsed time -> quarantine.
        const validation = validateEventTime({
          startsAt,
          rawTimeText: item.summary ?? null,
          headline: item.title,
          summary: item.summary ?? "",
        });

        if (!validation.ok) {
          // Send to the quarantine queue so admin can review or correct it.
          try {
            await storage.createQuarantinedEvent({
              sourceUrl: canonicalEv,
              sourceName: source.name,
              headline: item.title.slice(0, 300),
              summary: (item.summary ?? "").slice(0, 4000),
              venue: extractVenue(item.summary) ?? null,
              rawTimeText: item.summary ?? null,
              candidateStartsAt: startsAt ?? null,
              cityId: source.cityId ?? null,
              reason: validation.reason,
            });
          } catch (e) {
            // If quarantine insert fails (e.g. duplicate source_url unique?),
            // fall through and treat as a dup. We never publish without
            // confidence on the time.
          }
          duplicates++;
          continue;
        }

        // Time passed validation. Now run the desk classifier to override
        // the source-level default desk if a more specific category fits.
        // skipGemini=true to keep ingest fast; the rule layer catches the
        // obvious overrides (police, sports, civic, etc.).
        const deskResult = await classifyEvent(
          {
            headline: item.title,
            summary: item.summary ?? "",
            venue: extractVenue(item.summary) ?? source.name,
            sourceName: source.name,
          },
          { skipGemini: true },
        );
        // Use the classifier's desk only when a rule fired. Otherwise keep
        // the per-source calendarDesk (which is curated upstream).
        const finalDesk = deskResult.confidence === "rule" ? deskResult.desk : calendarDesk;

        await storage.createEvent({
          title: item.title.slice(0, 220),
          venue: extractVenue(item.summary) ?? source.name,
          startsAt: validation.startsAt,
          endsAt: null,
          sourceName: source.name,
          sourceUrl: canonicalEv,
          tag: "Event",
          desk: finalDesk,
          description: item.summary ?? null,
          cityId: source.cityId ?? null,
        });
        added++;
        continue;
      }

      // Apply the full skip list — opinion, jobs, classifieds, real-estate,
      // missing summary on news sources, items older than 14 days.
      const skip = shouldSkipItem(item, source);
      if (skip) {
        duplicates++;
        continue;
      }

      // Apply the learned-rules cache. live_rules is the table the cockpit's
      // proposed_rules promote into, plus auto-promoted entries from the
      // pattern scan. A match here means "a prior admin signal said items
      // matching this rule shouldn't be ingested" so we drop the item.
      const learnedSkip = await matchRules({
        sourceName: source.name,
        sourceUrl: source.url ?? null,
        title: item.title,
      });
      if (learnedSkip) {
        duplicates++;
        continue;
      }
      const canonical = canonicalizeUrl(item.url);

      // 1) Exact canonical URL dedupe
      const existing = await storage.findStoryByCanonicalUrl(canonical);
      if (existing) {
        duplicates++;
        continue;
      }

      // 2) Title-similarity clustering against recent approved stories.
      //    If we find a candidate AND it's from a different source, attach as an extra source.
      const cluster = await storage.findClusterCandidate(item.title, CLUSTER_WINDOW_MS);
      if (cluster && cluster.sourceName !== source.name) {
        await storage.attachStorySource(cluster.id, {
          sourceName: source.name,
          sourceUrl: canonical,
          sourceType: source.sourceType,
        });
        clustered++;
        continue;
      }

      // 3) Insert as a new story.
      const baseInsert = toInsertStory({ ...item, url: canonical }, source);
      const { story: insert, hits: ruleHits } = await applyClassificationRules(baseInsert, source);
      // Stamp the story with the source's city so per-city queries can scope it.
      (insert as any).cityId = source.cityId ?? null;
      const story = await storage.createStory(insert);
      if (ruleHits.length) await bumpHitCounts(ruleHits);
      // Seed the join table with the primary source so the drawer can uniformly
      // enumerate sources later (even for single-source stories we know about one).
      await storage.attachStorySource(story.id, {
        sourceName: source.name,
        sourceUrl: canonical,
        sourceType: source.sourceType,
      });
      newStoryIds.push(story.id);
      added++;
    } catch (err) {
      errors++;
    }
  }

  const finishedAt = new Date().toISOString();

  // Update source health + write the run log.
  const status = errors > 0 ? "error" : fetched > 0 ? "ok" : "stale";
  await storage.updateSourceHealth(source.id, {
    lastCheckedAt: finishedAt,
    lastStatus: status,
    lastMode: mode,
    lastError: errors > 0 || mode === "mock" ? message : null,
    lastItems: added,
  });

  await storage.recordIngestRun({
    sourceId: source.id,
    sourceName: source.name,
    startedAt,
    finishedAt,
    mode,
    fetched,
    added,
    duplicates,
    clustered,
    errors,
    message,
    cityId: source.cityId ?? null,
  });

  return {
    sourceId: source.id,
    sourceName: source.name,
    startedAt,
    finishedAt,
    mode,
    fetched,
    added,
    duplicates,
    clustered,
    errors,
    message,
    newStoryIds,
  };
}

export async function ingestAll(): Promise<RunSummary[]> {
  const sources = (await storage.listSources()).filter((s) => s.active);
  const summaries: RunSummary[] = [];
  // Run serially so the SQLite writes stay predictable; the total count is small.
  for (const s of sources) {
    try {
      summaries.push(await ingestSource(s));
    } catch (err: any) {
      summaries.push({
        sourceId: s.id,
        sourceName: s.name,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        mode: "mock",
        fetched: 0,
        added: 0,
        duplicates: 0,
        clustered: 0,
        errors: 1,
        message: err?.message ?? String(err),
        newStoryIds: [],
      });
    }
  }
  return summaries;
}

// -------- Scheduler --------
// Per-source cadence (defined in sources.cadenceMinutes). A single interval
// wakes every 60s, picks any sources whose lastCheckedAt is older than
// cadence, and runs them. Non-blocking for the rest of the app.

let timer: NodeJS.Timeout | null = null;

function dueNow(s: Source, now: number): boolean {
  if (!s.active) return false;
  if (!s.lastCheckedAt) return true;
  const last = Date.parse(s.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= s.cadenceMinutes * 60 * 1000;
}

async function tick() {
  const now = Date.now();
  const due = (await storage.listSources()).filter((s) => dueNow(s, now));
  for (const s of due) {
    try {
      await ingestSource(s);
    } catch {
      // swallow — run log already captures per-source errors
    }
  }
  // X (Twitter) ingest runs on its own cadence inside the same tick loop so
  // we don't spin up a second timer. tickXIfDue() reads its own last-polled-at
  // from x_list_cursor and decides whether to fire. See server/ingest/x-fetcher.ts.
  try {
    await tickXIfDue();
  } catch (err) {
    console.error("[ingest] tickXIfDue failed:", err);
  }
}

/**
 * Decide whether to poll X this tick. Adaptive cadence:
 *   - 15 minutes during 07:00-23:00 America/Denver (your local time)
 *   - 60 minutes overnight (23:00-07:00)
 *
 * Reads last_polled_at directly from x_list_cursor so the cadence persists
 * across server restarts.
 */
async function tickXIfDue(): Promise<void> {
  // Bail fast if the token isn't configured -- saves a DB roundtrip every tick
  // before the env var lands.
  if (!process.env.X_BEARER_TOKEN) return;

  const { db } = await import("../storage.js");
  const { xListCursor } = await import("../../shared/schema.js");
  const { eq } = await import("drizzle-orm");
  const { MONTANA_LIST_ID } = await import("./x-fetcher.js");

  const rows = await db
    .select()
    .from(xListCursor)
    .where(eq(xListCursor.listId, MONTANA_LIST_ID));
  const cursor = rows[0];
  if (!cursor) return; // migration's INSERT should have created this; skip if missing

  const last = cursor.lastPolledAt ? Date.parse(cursor.lastPolledAt) : 0;
  const ageMin = (Date.now() - last) / 60000;

  // Determine cadence by Mountain-Time hour. We use UTC for the comparison;
  // Denver is UTC-6 (MDT) or UTC-7 (MST). 07:00 local -> 13:00 or 14:00 UTC.
  // Close enough; cadence is approximate by design.
  const utcHour = new Date().getUTCHours();
  // Daytime in MT roughly = 13:00 - 06:00 UTC (i.e. 07:00 local - 23:00 local).
  const isDaytime = utcHour >= 13 || utcHour < 6;
  const cadenceMin = isDaytime ? 15 : 60;
  if (ageMin < cadenceMin) return;

  const result = await pollXList();
  if (result.polled) {
    console.log(
      `[x] poll ok — fetched ${result.tweetsFetched} tweets, ${result.newAuthors} new authors, monthly usage ${result.monthlyUsage}`,
    );
    // Right after pulling new tweets, drain the signal processor so any
    // article URLs from this batch become story candidates immediately.
    // The processor is bounded (BATCH_SIZE=30) so we cap its time per tick.
    try {
      const sig = await processXSignals();
      if (sig.processed > 0) {
        console.log(
          `[x] signals processed=${sig.processed} fetched=${sig.articlesFetched} failed=${sig.articlesFailed} signalsOnly=${sig.signalsOnly}`,
        );
      }
    } catch (err) {
      console.error("[x] signal processor failed:", err);
    }
  } else {
    console.log(`[x] poll skipped: ${result.reason}`);
  }
}

export function startScheduler() {
  if (timer) return;
  // Kick once at startup so the first run log is visible immediately, then
  // every 60s thereafter.
  void tick();
  timer = setInterval(() => {
    void tick();
  }, 60 * 1000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
