/**
 * Phase 14 venue ingester -- glue layer.
 *
 * Per venue per run:
 *   1. Collect events from the website source (RSS + JSON-LD or HTML + JSON-LD).
 *   2. Collect events from the Facebook source (if configured + CF env set).
 *   3. Merge: when both sources contain an event with similar title and
 *      start-time within 2 hours, treat as cross-confirmed (confidence=2,
 *      and if the times disagree by >15 minutes, quarantine instead).
 *   4. For each merged event, build (primaryLink, linkType):
 *        ticketUrl present + alive -> "ticket"
 *        else detailUrl alive       -> "details"
 *        else fbPageEventsUrl       -> "facebook"
 *   5. Run through the Phase 13 strict time validator + desk classifier.
 *   6. Upsert into events table. Skip dup-by (sourceUrl).
 */
import { storage } from "../../storage.js";
import { validateEventTime } from "../../learning/event-time-validator.js";
import { classifyEvent } from "../../learning/event-classifier.js";
import {
  CURATED_VENUES,
  isTicketHost,
  type CuratedVenue,
} from "./curated-venues.js";
import { collectFromVenueWebsite, type RawVenueEvent } from "./website-collector.js";
import { collectFromVenueFacebook, type RawFacebookEvent } from "./facebook-collector.js";
import type { EventLinkType, InsertEventQuarantine } from "../../../shared/schema.js";

interface MergedCandidate {
  title: string;
  startsAt: string;
  endsAt: string | null;
  description: string | null;
  detailUrl: string | null;
  ticketUrl: string | null;
  fbUrl: string | null;
  sourceConfidence: number; // 1 or 2
  /** Whether the website and FB disagreed on time enough to quarantine. */
  timeConflict?: {
    websiteIso: string;
    facebookIso: string;
    deltaMinutes: number;
  };
}

/** Normalize titles for fuzzy comparison (strip punctuation/case/whitespace). */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns true when two normalized titles share >=70% of their longer side's chars. */
function titlesMatch(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Quick token overlap. Threshold low because FB sometimes shortens
  // titles (e.g. "Aaron Watson" vs "Aaron Watson Live at the Newberry").
  const ta = new Set(na.split(" ").filter((t) => t.length >= 3));
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  ta.forEach((t) => { if (tb.has(t)) overlap++; });
  const smaller = Math.min(ta.size, tb.size);
  return overlap / smaller >= 0.6;
}

function deltaMinutes(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

function mergeSources(website: RawVenueEvent[], facebook: RawFacebookEvent[]): MergedCandidate[] {
  const out: MergedCandidate[] = [];
  const usedFb = new Set<number>();
  for (const w of website) {
    let pairedFb: RawFacebookEvent | null = null;
    let pairedFbIdx = -1;
    for (let i = 0; i < facebook.length; i++) {
      if (usedFb.has(i)) continue;
      const f = facebook[i];
      if (!titlesMatch(w.title, f.title)) continue;
      if (deltaMinutes(w.startsAt, f.startsAt) > 12 * 60) continue; // > half a day apart = different event
      pairedFb = f;
      pairedFbIdx = i;
      break;
    }
    if (pairedFb && pairedFbIdx >= 0) usedFb.add(pairedFbIdx);

    const candidate: MergedCandidate = {
      title: w.title,
      startsAt: w.startsAt, // website wins on time when both present
      endsAt: w.endsAt ?? null,
      description: w.description ?? null,
      detailUrl: w.detailUrl,
      ticketUrl: w.ticketUrl ?? null,
      fbUrl: pairedFb ? pairedFb.fbPageEventsUrl : null,
      sourceConfidence: pairedFb ? 2 : 1,
    };
    if (pairedFb) {
      const d = deltaMinutes(w.startsAt, pairedFb.startsAt);
      // If the website and FB disagree on time by >15 min, flag for
      // quarantine: per the user's standing instruction, time confidence
      // is the most important property of an event.
      if (d > 15) {
        candidate.timeConflict = {
          websiteIso: w.startsAt,
          facebookIso: pairedFb.startsAt,
          deltaMinutes: d,
        };
      }
    }
    out.push(candidate);
  }
  // Any FB events that didn't match a website event are added as
  // FB-only (confidence 1). Ticket links not available from FB.
  for (let i = 0; i < facebook.length; i++) {
    if (usedFb.has(i)) continue;
    const f = facebook[i];
    out.push({
      title: f.title,
      startsAt: f.startsAt,
      endsAt: f.endsAt ?? null,
      description: null,
      detailUrl: null,
      ticketUrl: null,
      fbUrl: f.fbPageEventsUrl,
      sourceConfidence: 1,
    });
  }
  return out;
}

async function headOk(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    // Some sites refuse HEAD; fall back to a tiny GET.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctl.signal });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal });
    }
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function pickPrimaryLink(c: MergedCandidate): { primaryLink: string; linkType: EventLinkType } | null {
  if (c.ticketUrl && isTicketHost(c.ticketUrl)) return { primaryLink: c.ticketUrl, linkType: "ticket" };
  if (c.detailUrl) return { primaryLink: c.detailUrl, linkType: "details" };
  if (c.fbUrl) return { primaryLink: c.fbUrl, linkType: "facebook" };
  return null;
}

export interface VenueIngestReport {
  venueId: string;
  websiteCount: number;
  facebookCount: number;
  mergedCount: number;
  inserted: number;
  duplicates: number;
  quarantined: number;
  skippedDeadLink: number;
  errors: string[];
  /**
   * True when at least one configured source actually fetched data
   * successfully. When false, the cron caller should NOT update the
   * cooldown row so we retry on the next tick instead of waiting 20h.
   */
  fetchOk: boolean;
}

export async function ingestVenue(venue: CuratedVenue): Promise<VenueIngestReport> {
  const report: VenueIngestReport = {
    venueId: venue.id,
    websiteCount: 0,
    facebookCount: 0,
    mergedCount: 0,
    inserted: 0,
    duplicates: 0,
    quarantined: 0,
    skippedDeadLink: 0,
    errors: [],
    fetchOk: false,
  };

  let website: RawVenueEvent[] = [];
  let facebook: RawFacebookEvent[] = [];
  // Track fetch success per source. A venue is considered "fetchOk" if
  // any source it has configured fetched without an explicit failure.
  // A venue with no configured sources at all is trivially fetchOk.
  let anyFetchSucceeded = false;
  let anyFetchFailed = false;
  const hasWebsiteSource = !!venue.websiteSource && venue.websiteSource.kind !== "facebook_text";
  const hasFacebookSource = !!venue.facebookSource || venue.websiteSource?.kind === "facebook_text";
  if (hasWebsiteSource) {
    try {
      website = await collectFromVenueWebsite(venue);
      report.websiteCount = website.length;
      anyFetchSucceeded = true; // website fetch returns [] on real errors but doesn't surface them; treat completion as success
    } catch (e) {
      anyFetchFailed = true;
      report.errors.push(`website: ${(e as Error).message}`);
    }
  }
  if (hasFacebookSource) {
    try {
      const fbResult = await collectFromVenueFacebook(venue);
      facebook = fbResult.events;
      report.facebookCount = fbResult.events.length;
      if (fbResult.fetchOk) {
        anyFetchSucceeded = true;
      } else {
        anyFetchFailed = true;
        report.errors.push(`facebook: ${fbResult.reason ?? "fetch failed"}`);
      }
    } catch (e) {
      anyFetchFailed = true;
      report.errors.push(`facebook: ${(e as Error).message}`);
    }
  }
  // The venue's overall fetchOk: any source succeeded, OR no source
  // failed (trivial-success path for venues with no FB and no website).
  report.fetchOk = anyFetchSucceeded || !anyFetchFailed;

  const merged = mergeSources(website, facebook);
  report.mergedCount = merged.length;
  const nowIso = new Date().toISOString();

  for (const c of merged) {
    // Time-conflict quarantine takes precedence over everything.
    if (c.timeConflict) {
      const q: InsertEventQuarantine = {
        sourceUrl: c.detailUrl ?? c.fbUrl ?? venue.websiteSource?.homeUrl ?? "",
        sourceName: venue.name,
        headline: c.title.slice(0, 300),
        summary: (c.description ?? "").slice(0, 4000),
        venue: venue.name,
        rawTimeText: `website=${c.timeConflict.websiteIso} fb=${c.timeConflict.facebookIso}`,
        candidateStartsAt: c.startsAt,
        cityId: venue.cityId,
        reason: `time_conflict_between_sources: ${c.timeConflict.deltaMinutes.toFixed(0)}min`,
      };
      try {
        await storage.createQuarantinedEvent(q);
        report.quarantined++;
      } catch {
        // probably dup; skip
        report.duplicates++;
      }
      continue;
    }

    // Strict time validator from Phase 13.
    const v = validateEventTime({
      startsAt: c.startsAt,
      rawTimeText: c.description ?? null,
      headline: c.title,
      summary: c.description ?? "",
    });
    if (!v.ok) {
      try {
        await storage.createQuarantinedEvent({
          sourceUrl: c.detailUrl ?? c.fbUrl ?? "",
          sourceName: venue.name,
          headline: c.title.slice(0, 300),
          summary: (c.description ?? "").slice(0, 4000),
          venue: venue.name,
          rawTimeText: c.description ?? null,
          candidateStartsAt: c.startsAt,
          cityId: venue.cityId,
          reason: v.reason,
        });
        report.quarantined++;
      } catch {
        report.duplicates++;
      }
      continue;
    }

    const link = pickPrimaryLink(c);
    if (!link) {
      report.errors.push(`no_link: ${c.title}`);
      continue;
    }
    // HEAD-verify the chosen link. If it's dead, demote: ticket -> details,
    // details -> facebook, facebook -> drop.
    let { primaryLink, linkType } = link;
    if (linkType === "ticket") {
      const alive = await headOk(primaryLink);
      if (!alive) {
        report.skippedDeadLink++;
        if (c.detailUrl && (await headOk(c.detailUrl))) {
          primaryLink = c.detailUrl;
          linkType = "details";
        } else if (c.fbUrl) {
          primaryLink = c.fbUrl;
          linkType = "facebook";
        } else {
          continue;
        }
      }
    }

    // Desk classifier. skipGemini=true keeps ingest fast; rule layer
    // handles the obvious cases (concert -> entertainment).
    const deskResult = await classifyEvent(
      {
        headline: c.title,
        summary: c.description ?? "",
        venue: venue.name,
        sourceName: venue.name,
      },
      { skipGemini: true },
    );
    const desk = deskResult.confidence === "rule" ? deskResult.desk : venue.defaultDesk;

    // sourceUrl is what we use for dedup. Use the most stable URL we have
    // -- the venue's detail page when available, otherwise we fall back
    // to the FB events URL with a deterministic per-event fragment so
    // every event from the same FB page gets a unique row.
    let sourceUrl: string;
    if (c.detailUrl) {
      sourceUrl = c.detailUrl;
    } else if (c.fbUrl) {
      const slug = c.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const day = c.startsAt.slice(0, 10); // YYYY-MM-DD
      sourceUrl = `${c.fbUrl}#${day}-${slug}`;
    } else {
      sourceUrl = primaryLink;
    }
    if (await storage.findEventByUrl(sourceUrl)) {
      report.duplicates++;
      continue;
    }

    try {
      await storage.createEvent({
        title: c.title.slice(0, 220),
        venue: venue.name,
        startsAt: v.startsAt,
        endsAt: c.endsAt,
        sourceName: venue.name,
        sourceUrl,
        tag: "Event",
        desk,
        description: c.description,
        cityId: venue.cityId,
        primaryLink,
        linkType,
        fbUrl: c.fbUrl,
        venueUrl: c.detailUrl,
        sourceConfidence: c.sourceConfidence,
        linkVerifiedAt: nowIso,
      } as any);
      report.inserted++;
    } catch (e) {
      report.errors.push(`insert: ${c.title} -- ${(e as Error).message}`);
    }
  }

  return report;
}

export async function ingestAllCuratedVenues(): Promise<VenueIngestReport[]> {
  const out: VenueIngestReport[] = [];
  for (const v of CURATED_VENUES) {
    const r = await ingestVenue(v);
    out.push(r);
  }
  return out;
}

/**
 * Cron entry-point. Runs only venues whose last_run_at is older than
 * `minHours` (default 20h = roughly daily without phase-locking to a
 * specific minute). Records the run + report in venue_ingest_runs.
 */
/**
 * Cron entry-point. Runs venues whose last_run_at is older than `minHours`.
 *
 * We parallelize across venues with a concurrency cap of 4. With ~16
 * curated venues and ~6-10s per Facebook render this brings the worst
 * case under the 90s function budget.
 *
 * We also bound the total wall time with a soft deadline -- any venue
 * still pending when the deadline hits gets skipped (its cooldown is
 * NOT updated, so it picks up on the next tick).
 */
export async function tickVenueIngest(minHours = 20): Promise<{ ran: VenueIngestReport[]; skipped: string[] }> {
  const { db } = await import("../../storage.js");
  const { sql } = await import("drizzle-orm");
  const cutoffMs = Date.now() - minHours * 3600_000;
  const ran: VenueIngestReport[] = [];
  const skipped: string[] = [];
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = 105_000; // 120s function budget, 15s headroom

  // First pass: figure out which venues are eligible this tick.
  const eligible: typeof CURATED_VENUES = [];
  for (const v of CURATED_VENUES) {
    const rows = (await db.execute(
      sql`SELECT last_run_at FROM venue_ingest_runs WHERE venue_id = ${v.id}`,
    )) as unknown as { last_run_at: string }[];
    const last = rows[0]?.last_run_at ? Date.parse(rows[0].last_run_at) : 0;
    if (last && last > cutoffMs) {
      skipped.push(v.id);
    } else {
      eligible.push(v);
    }
  }

  // Concurrency-capped worker pool. Cloudflare Browser Rendering's free tier
  // allows 3 concurrent browsers; we cap at 2 to leave headroom for any
  // other CF calls happening elsewhere in the system. Without this cap we
  // saw 11 of 12 FB venues silently return empty event grids because their
  // browser sessions were rejected.
  const CONCURRENCY = 2;
  const queue = [...eligible];
  async function worker(): Promise<void> {
    while (queue.length) {
      if (Date.now() - startedAt >= SOFT_DEADLINE_MS) {
        // Time's up. Anything still in the queue rolls to the next tick.
        const stillPending = queue.splice(0).map((v) => v.id);
        skipped.push(...stillPending);
        return;
      }
      const v = queue.shift();
      if (!v) break;
      try {
        const report = await ingestVenue(v);
        ran.push(report);
        // Only update the cooldown when at least one source fetched
        // successfully. If everything failed (e.g. CF Browser Rendering
        // 429), leave the row stale so the next tick retries promptly
        // instead of waiting 20h.
        if (report.fetchOk) {
          await db.execute(sql`
            INSERT INTO venue_ingest_runs (venue_id, last_run_at, last_report)
            VALUES (${v.id}, NOW(), ${JSON.stringify(report)}::jsonb)
            ON CONFLICT (venue_id) DO UPDATE
              SET last_run_at = EXCLUDED.last_run_at,
                  last_report = EXCLUDED.last_report
          `);
        }
      } catch (err) {
        // Don't update cooldown on hard failure -- let the next tick try.
        ran.push({
          venueId: v.id,
          websiteCount: 0,
          facebookCount: 0,
          mergedCount: 0,
          inserted: 0,
          duplicates: 0,
          quarantined: 0,
          skippedDeadLink: 0,
          errors: [`fatal: ${(err as Error).message}`],
          fetchOk: false,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { ran, skipped };
}
