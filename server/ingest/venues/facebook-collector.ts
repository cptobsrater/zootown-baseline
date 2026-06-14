/**
 * Facebook venue events collector (Phase 14).
 *
 * Facebook pages serve a logged-out events tab that renders event cards
 * with date, time, title, venue address, organizer, and city -- all in
 * plain visible text. We proved this in the recon probe against MetraPark
 * and harvested 8 upcoming events with confident start times. The recon
 * also showed that the city-level discovery feed
 * (/events/explore/<city>/) is gated behind login -- venue pages are
 * usable, city pages are not.
 *
 * We use Cloudflare Browser Rendering's /content endpoint to fetch the
 * fully-rendered HTML (Facebook is a React SPA -- raw fetch gets you
 * nothing). Required env:
 *   CLOUDFLARE_ACCOUNT_ID  -- the Cloudflare account that owns Browser
 *                              Rendering (a37e74fd45669d984e7fb665bda317a5
 *                              for ZooTown)
 *   CLOUDFLARE_API_TOKEN   -- a token with Browser Rendering: Read
 *
 * If either env is missing, this collector logs once and returns empty.
 * Website-source venues keep working without it.
 */
import type { CuratedVenue } from "./curated-venues.js";

export interface RawFacebookEvent {
  title: string;
  /** Parsed ISO string -- may be a date-only ("2026-06-14") for range events. */
  startsAt: string;
  endsAt?: string | null;
  /** The Facebook page URL for the event tab (we don't have per-event URLs). */
  fbPageEventsUrl: string;
  rawTimeText: string;
  venueLine?: string | null;
  organizer?: string | null;
}

let warnedAboutMissingEnv = false;

async function renderFacebookEvents(slug: string): Promise<string | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    if (!warnedAboutMissingEnv) {
      console.warn(
        "[facebook-collector] CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set; FB sources will be skipped.",
      );
      warnedAboutMissingEnv = true;
    }
    return null;
  }
  const url = `https://www.facebook.com/${encodeURIComponent(slug)}/events`;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        url,
        viewport: { width: 1280, height: 1800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[facebook-collector] CF browser-rendering HTTP ${res.status} for ${slug}`);
      return null;
    }
    const json = (await res.json()) as { success: boolean; result?: string };
    if (!json.success || typeof json.result !== "string") return null;
    return json.result;
  } catch (e) {
    console.warn(`[facebook-collector] CF browser-rendering fetch failed for ${slug}: ${(e as Error).message}`);
    return null;
  }
}

/** Strip HTML to readable text and collapse whitespace. */
function htmlToText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  // Decode the entities we actually see in FB output.
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Parse the linear visible-text dump of Facebook's events tab into event
 * blocks. The grammar we saw on MetraPark is extremely consistent:
 *
 *   <Day>, <DD> <Mon> at <HH:MM> <TZ> <Title> <Venue line> · <City> Event by <Organizer>
 *
 * Multi-day events drop "at <time>":
 *
 *   <Day>, <DD> <Mon>-<DD> <Mon> <Title> <Venue line> · <City> Event by <Organizer>
 *
 * We anchor on the day-of-week prefix because it's the most reliable
 * separator between cards. Anything that doesn't match the grammar gets
 * silently skipped -- the Phase 13 validator/quarantine pipeline takes
 * care of edge cases downstream.
 */
const DAYS = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
const MONTHS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const EVENT_SPLIT_RE = new RegExp(`(?=${DAYS},\\s+\\d{1,2}\\s+${MONTHS}\\b)`, "g");
// Header: weekday, day-of-month, month, optional "-day month" range, optional "at HH:MM TZ"
const HEADER_RE = new RegExp(
  `^${DAYS},\\s+(\\d{1,2})\\s+(${MONTHS})(?:-(\\d{1,2})\\s+(${MONTHS}))?(?:\\s+at\\s+(\\d{1,2}:\\d{2})\\s+([A-Z]{2,5}))?\\b`,
);

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Resolve "10 Jun" + "19:00 MDT" into an ISO string. Year is inferred:
 * if the month/day combo is in the past relative to today, we bump by
 * one year (Facebook's events tab is always future-facing).
 */
function resolveIso(dayStr: string, monthStr: string, timeStr?: string, tz?: string): string | null {
  const dd = Number(dayStr);
  const mm = MONTH_NUM[monthStr.toLowerCase()];
  if (!Number.isFinite(dd) || !mm) return null;
  const now = new Date();
  let year = now.getUTCFullYear();
  // We assume MDT/MST for unspecified Montana times. Time string is
  // either "HH:MM" or absent.
  let hh = 0, mi = 0;
  if (timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    hh = h; mi = m;
  }
  // Build a candidate date as local Montana time using offset -06:00 (MDT)
  // unless tz explicitly says MST. Most of Montana's event season is MDT.
  const offset = tz === "MST" ? "-07:00" : "-06:00";
  const candidate = new Date(
    `${year.toString().padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00${offset}`,
  );
  if (!Number.isFinite(candidate.getTime())) return null;
  // If it's more than 30 days in the past, bump to next year.
  if (candidate.getTime() < now.getTime() - 30 * 86400_000) {
    year += 1;
    const bumped = new Date(
      `${year.toString().padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00${offset}`,
    );
    return bumped.toISOString();
  }
  return candidate.toISOString();
}

function parseEvents(visibleText: string, fbPageEventsUrl: string): RawFacebookEvent[] {
  // Trim everything before "Upcoming" -- Facebook puts nav + page meta first.
  const idx = visibleText.indexOf("Upcoming");
  const body = idx >= 0 ? visibleText.slice(idx) : visibleText;
  // Drop the trailing login form.
  const endIdx = body.indexOf("See more on Facebook");
  const trimmed = endIdx > 0 ? body.slice(0, endIdx) : body;

  // Split on "Past" -- we only want upcoming events, not past ones.
  const upcomingOnly = trimmed.split(/\bPast\b/)[0] ?? trimmed;

  // Now cut at each day-of-week header.
  const parts = upcomingOnly.split(EVENT_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  const out: RawFacebookEvent[] = [];

  for (const part of parts) {
    const headerMatch = part.match(HEADER_RE);
    if (!headerMatch) continue;
    const [matched, dayStr, monthStr, _endDay, _endMonth, timeStr, tz] = headerMatch;
    const rest = part.slice(matched.length).trim();
    if (!rest) continue;

    // The structure of `rest` is: "<Title> <Venue line> · <City> Event by <Organizer>"
    // We split on " Event by " first to grab the organizer, then on "·"
    // to split title/venue from city.
    const byIdx = rest.lastIndexOf(" Event by ");
    const organizer = byIdx >= 0 ? rest.slice(byIdx + " Event by ".length).trim() : null;
    const beforeBy = byIdx >= 0 ? rest.slice(0, byIdx).trim() : rest;

    // "<Title> <Venue> · <City>" -- last "·" splits city off the end.
    const dotIdx = beforeBy.lastIndexOf("·");
    const titleAndVenue = dotIdx >= 0 ? beforeBy.slice(0, dotIdx).trim() : beforeBy;
    // We don't know exactly where the venue starts within titleAndVenue
    // for every event. The conservative move is to keep the whole string
    // as the title and store venue separately only when we see an obvious
    // address (street number + street). Otherwise leave venue null.
    const addrMatch = titleAndVenue.match(/\b\d{2,5}\s+[A-Z][^,]+,\s*[A-Z][A-Za-z]+/);
    let title = titleAndVenue;
    let venueLine: string | null = null;
    if (addrMatch) {
      const at = titleAndVenue.indexOf(addrMatch[0]);
      title = titleAndVenue.slice(0, at).trim();
      venueLine = titleAndVenue.slice(at).trim();
    } else {
      // Heuristic: title is the first run before a likely-venue cue
      // (e.g. " MetraPark "). For now keep titleAndVenue as title and
      // leave venue null; ingest will use the curated venue name.
      title = titleAndVenue;
    }

    const startsAt = resolveIso(dayStr, monthStr, timeStr, tz);
    if (!startsAt || !title) continue;

    out.push({
      title: title.slice(0, 220),
      startsAt,
      endsAt: null,
      fbPageEventsUrl,
      rawTimeText: matched,
      venueLine,
      organizer,
    });
  }
  return out;
}

export async function collectFromVenueFacebook(venue: CuratedVenue): Promise<RawFacebookEvent[]> {
  const slug = venue.facebookSource?.slug ?? (venue.websiteSource?.kind === "facebook_text" ? new URL(venue.websiteSource.listUrl).pathname.split("/").filter(Boolean)[0] : null);
  if (!slug) return [];
  const html = await renderFacebookEvents(slug);
  if (!html) return [];
  const text = htmlToText(html);
  const url = `https://www.facebook.com/${slug}/events`;
  return parseEvents(text, url);
}
