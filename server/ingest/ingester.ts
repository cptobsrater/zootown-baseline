import type { Source } from "../../shared/schema.js";
import { storage } from "../storage.js";
import { rssFetcher } from "./rss.js";
import { htmlFetcher } from "./html.js";
import { headlessFetcher } from "./headless.js";
import { canonicalizeUrl, toInsertStory, shouldSkipItem } from "./normalize.js";
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
  let calendarDesk = "culture";
  if (isCalendar && source.desks) {
    try {
      const parsed = JSON.parse(source.desks);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        calendarDesk = parsed[0];
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
        const startsAt = parseEventDate(item.summary, item.publishedAt) ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        await storage.createEvent({
          title: item.title.slice(0, 220),
          venue: extractVenue(item.summary) ?? source.name,
          startsAt,
          endsAt: null,
          sourceName: source.name,
          sourceUrl: canonicalEv,
          tag: "Event",
          desk: calendarDesk,
          description: item.summary ?? null,
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
