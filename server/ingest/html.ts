import type { Source } from "../../shared/schema.js";
import type { Fetcher, FetchResult, RawItem } from "./types.js";
import { loadFixture } from "./fixtures.js";

/**
 * HTML fetcher for sources without RSS feeds. In a production build each
 * `parserKey` would map to a dedicated extractor that understands the page's
 * markup. For the prototype we attempt a live GET + a lightweight generic
 * extraction (look for <article> / headline patterns) and always fall back to
 * the fixtures file if nothing meaningful is produced. This keeps the demo
 * reliable without baking in a dozen fragile parsers.
 */

// Parsers may be sync OR async. Async parsers can issue secondary HTTP
// requests (e.g. follow listing pages to event detail pages for show times).
// The dispatcher awaits the result either way.
type ParserFn = (html: string, source: Source) => RawItem[] | Promise<RawItem[]>;

const PARSERS: Record<string, ParserFn> = {
  "destination-missoula": genericArticleParser,
  "downtown-partnership": genericArticleParser,
  "fairgrounds": genericArticleParser,
  "chamber": genericArticleParser,
  "library": genericArticleParser,
  "zacc": genericArticleParser,
  "missoula-events": missoulaEventsParser,
  // Two-stage parser: listing page -> per-event detail fetch for show time.
  // Handles all four Logjam-managed venues (Logjam main, KettleHouse, Wilma,
  // ELM Bozeman, Top Hat) because they share the same /event/<slug> URL space.
  // Per-source venue filtering is applied inside the parser using source.name.
  "logjam": logjamDetailParser,
  // "json-ld" is the generic event extractor for venue pages that embed
  // schema.org Event records in <script type="application/ld+json"> blocks.
  // Used as the default for category=calendars when no parserKey is set.
  "json-ld": jsonLdEventParser,
};

/**
 * Generic schema.org Event extractor.
 *
 * Many venue/ticketing sites embed JSON-LD blocks describing upcoming Event
 * objects — each with a name, startDate, location, and url. We collect them
 * all into RawItems so the calendar ingester can route them to the events
 * table with real start times.
 */
function jsonLdEventParser(html: string, source: Source): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  const blockRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  function addEvent(node: any) {
    if (!node || typeof node !== "object") return;
    // Handle a missing @type but recognizable event shape (Eventbrite ListItem.item).
    const t = node["@type"];
    const looksLikeEvent =
      t === "Event" || t === "MusicEvent" || t === "TheaterEvent" ||
      t === "SportsEvent" || t === "Festival" || t === "DanceEvent" ||
      t === "ComedyEvent" || t === "EducationEvent" || t === "BusinessEvent" ||
      t === "FoodEvent" || t === "ScreeningEvent" || t === "PublicationEvent" ||
      t === "SocialEvent" || t === "ChildrensEvent" ||
      (Array.isArray(t) && t.some((x) => /Event/i.test(String(x)))) ||
      // Some sites omit @type but include startDate + name + url (Eventbrite does this)
      (!t && typeof node.name === "string" && typeof node.startDate === "string" && typeof node.url === "string");
    if (!looksLikeEvent) return;
    const title = (node.name ?? "").toString().trim();
    const startDate = (node.startDate ?? node.start ?? "").toString().trim();
    const url = (node.url ?? node["@id"] ?? source.url ?? "").toString().trim();
    if (!title || !startDate || !url) return;
    if (seen.has(url)) return;
    seen.add(url);
    const venue = typeof node.location === "object"
      ? (node.location?.name ?? node.location?.["@name"] ?? null)
      : (typeof node.location === "string" ? node.location : null);
    const description = (node.description ?? "").toString().trim().slice(0, 280);
    const summaryParts: string[] = [];
    if (startDate) summaryParts.push(startDate);
    if (venue) summaryParts.push(String(venue));
    if (description) summaryParts.push(description);
    items.push({
      title: title.slice(0, 220),
      url,
      categories: ["Event"],
      summary: summaryParts.join(" · ") || undefined,
      publishedAt: startDate, // calendar ingester reads this as event start time
    });
  }

  while ((m = blockRe.exec(html)) !== null && items.length < 80) {
    let parsed: any;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    // Walk every node in the JSON-LD tree. Handles single objects, arrays,
    // @graph wrappers, and Eventbrite-style ItemList / ListItem.item nesting.
    const stack: any[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (stack.length && items.length < 80) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      if (Array.isArray(node.itemListElement)) stack.push(...node.itemListElement);
      if (node.item && typeof node.item === "object") stack.push(node.item);
      addEvent(node);
    }
  }
  return items;
}

// ----- Logjam two-stage parser -----------------------------------------
//
// Logjam Presents manages four venues that all share the same
// logjampresents.com/event/<slug>/ URL space:
//
//   - KettleHouse Amphitheater (Missoula, outdoor concert venue)
//   - The Wilma                (Missoula, downtown theater)
//   - Top Hat                  (Missoula, club)
//   - The ELM                  (Bozeman, theater)
//
// Stage 1: fetch the listing page (/events/) and extract every unique
//          /event/<slug> URL.
// Stage 2: for each event URL, fetch the detail page and pull title,
//          venue, full date, and **show time** (start-of-event). The
//          listing page only has dates, not times -- times live behind
//          each detail page.
//
// Per-source filter: the same listing serves all four venues, so each
// registered source (one per venue) keeps only the events whose detail
// page reports the matching venue. KettleHouse->Missoula, ELM->Bozeman,
// etc. -- mapped via source.name.
//
// Throttle: max 25 detail fetches per run, 150ms inter-request gap,
// concurrency = 4.

const LOGJAM_DOOR_TIME_RE =
  /class="door-time"[^>]*>\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i;
const LOGJAM_SHOW_TIME_RE =
  /class="show-time"[^>]*>\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i;
const LOGJAM_VENUE_TITLE_RE =
  /class="venue-title"[^>]*>\s*([^<]+?)\s*</i;
const LOGJAM_OG_DESC_RE =
  /<meta\s+property="og:description"\s+content="([^"]+)"/i;
const LOGJAM_PROSE_DATE_RE =
  /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const LOGJAM_TITLE_RE = /<title>([^<]+?)\s*-\s*Logjam Presents<\/title>/i;

const MONTHS_LONG: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Given a Montana local date, return the UTC offset hours.
 * MDT (UTC-6) when DST is in effect (2nd Sun of March -> 1st Sun of Nov),
 * MST (UTC-7) otherwise.
 */
function mountainOffsetHours(year: number, month0: number, day: number): number {
  // Second Sunday of March
  const march1 = new Date(Date.UTC(year, 2, 1));
  const daysToFirstSun = (7 - march1.getUTCDay()) % 7;
  const dstStart = new Date(Date.UTC(year, 2, 1 + daysToFirstSun + 7));
  // First Sunday of November
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const daysToFirstSunNov = (7 - nov1.getUTCDay()) % 7;
  const dstEnd = new Date(Date.UTC(year, 10, 1 + daysToFirstSunNov));
  const probe = new Date(Date.UTC(year, month0, day));
  return probe >= dstStart && probe < dstEnd ? -6 : -7;
}

/**
 * Map a registered source (KettleHouse, Wilma, ELM, Top Hat, or the
 * umbrella "Logjam Presents") to the venue substring we expect to see
 * on the detail page. Returns null for the umbrella feed (accept all).
 */
function logjamVenueFilter(source: Source): RegExp | null {
  const name = (source.name || "").toLowerCase();
  if (name.includes("kettlehouse")) return /kettlehouse/i;
  if (name.includes("wilma")) return /wilma/i;
  if (name.includes("elm")) return /\bELM\b/;
  if (name.includes("top hat")) return /top\s*hat/i;
  // "Logjam Presents" without a venue qualifier = umbrella feed; accept all.
  return null;
}

/**
 * Extract structured event data from a Logjam detail page. Returns null
 * when the page does not have a confident show time -- private rentals,
 * "on sale soon" placeholders, etc.
 */
function extractLogjamDetail(
  url: string,
  html: string,
): { title: string; venue: string | null; startsAtIso: string; doorTime: string | null; showTime: string | null } | null {
  const titleM = html.match(LOGJAM_TITLE_RE);
  const title = titleM ? titleM[1].trim() : null;
  if (!title) return null;

  const dateM = html.match(LOGJAM_PROSE_DATE_RE);
  if (!dateM) return null;
  const monthName = dateM[1].toLowerCase();
  const month0 = MONTHS_LONG[monthName];
  if (month0 === undefined) return null;
  const day = Number(dateM[2]);
  const year = Number(dateM[3]);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;

  // Prefer show time (canonical start); fall back to door time.
  const showM = html.match(LOGJAM_SHOW_TIME_RE);
  const doorM = html.match(LOGJAM_DOOR_TIME_RE);
  const chosen = showM?.[1] ?? doorM?.[1];
  if (!chosen) return null;
  const hm = chosen.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/);
  if (!hm) return null;
  let hh = Number(hm[1]) % 12;
  const mm = Number(hm[2]);
  if (hm[3].toUpperCase() === "PM") hh += 12;

  // Venue: structural class first, then og:description prose.
  let venue: string | null = null;
  const venueM = html.match(LOGJAM_VENUE_TITLE_RE);
  if (venueM) venue = venueM[1].trim();
  if (!venue) {
    const ogM = html.match(LOGJAM_OG_DESC_RE);
    const og = ogM ? ogM[1] : "";
    for (const v of ["KettleHouse Amphitheater", "The Wilma", "The ELM", "Top Hat"]) {
      if (og.toLowerCase().includes(v.toLowerCase())) {
        venue = v;
        break;
      }
    }
  }

  // Construct UTC ISO timestamp. Local Montana time + sign-flipped offset.
  // offset is -6 (MDT) or -7 (MST); UTC = local - offset = local + |offset|.
  const offsetH = mountainOffsetHours(year, month0, day);
  const localMs = Date.UTC(year, month0, day, hh, mm);
  const utcMs = localMs - offsetH * 3600 * 1000;
  const startsAtIso = new Date(utcMs).toISOString();

  return {
    title,
    venue,
    startsAtIso,
    doorTime: doorM?.[1] ?? null,
    showTime: showM?.[1] ?? null,
  };
}

async function logjamDetailParser(html: string, source: Source): Promise<RawItem[]> {
  // ---- Stage 1: extract event URLs from listing page ----
  const urlSet = new Set<string>();
  const urlRe =
    /href=["'](https?:\/\/(?:www\.)?logjampresents\.com\/event\/[^"'#?]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(html)) !== null) {
    urlSet.add(m[1].trim());
  }
  if (urlSet.size === 0) return [];

  // Cap at 25 detail fetches per run to keep ingestion fast and polite.
  const urls = Array.from(urlSet).slice(0, 25);

  // ---- Stage 2: fetch each detail page (concurrency=4) ----
  const venueFilter = logjamVenueFilter(source);
  const items: RawItem[] = [];
  const CONCURRENCY = 4;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const idx = cursor++;
      const eventUrl = urls[idx];
      try {
        const res = await fetchWithTimeout(eventUrl, 6000);
        if (!res.ok) continue;
        const detailHtml = await res.text();
        const parsed = extractLogjamDetail(eventUrl, detailHtml);
        if (!parsed) continue;
        // Per-source venue filter: skip events at other Logjam venues.
        if (venueFilter && parsed.venue && !venueFilter.test(parsed.venue)) {
          continue;
        }
        const summaryParts: string[] = [parsed.startsAtIso];
        if (parsed.venue) summaryParts.push(parsed.venue);
        if (parsed.showTime) summaryParts.push(`Show ${parsed.showTime}`);
        if (parsed.doorTime) summaryParts.push(`Doors ${parsed.doorTime}`);
        items.push({
          title: parsed.title.slice(0, 220),
          url: eventUrl,
          categories: ["Event"],
          summary: summaryParts.join(" \u00b7 "),
          // ingester.ts reads publishedAt as the canonical event start time
          // for calendar-category sources. The confidence guard in
          // server/storage.ts (rowToStory) will accept this because it
          // differs from the row's published_at by far more than 60s.
          publishedAt: parsed.startsAtIso,
        });
      } catch {
        // Network/timeout/parse error on one event -- skip, keep going.
      }
      // Polite gap to avoid hammering the venue site.
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const inFlight: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i++) {
    inFlight.push(worker());
  }
  await Promise.all(inFlight);

  return items;
}

/** MissoulaEvents.com — list of upcoming community events. */
function missoulaEventsParser(html: string, source: Source): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  // Try anchors that link to /events/<slug>/ or /event/<slug>/
  const re = /<a[^>]+href="(\/events?\/[^"#?]+)"[^>]*>([^<]{6,180})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < 16) {
    const href = m[1].trim();
    const text = stripHtml(m[2]);
    if (!text || text.length < 6) continue;
    if (looksNav(text, href)) continue;
    let fullUrl: string;
    try {
      const base = new URL(source.url);
      fullUrl = href.startsWith("http") ? href : `${base.origin}${href}`;
    } catch {
      continue;
    }
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    items.push({ title: text, url: fullUrl, categories: ["Event"] });
  }
  // Fallback: also try the generic parser if we got nothing
  if (items.length === 0) return genericArticleParser(html, source);
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#038;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

// Skip links whose text/url is almost certainly navigation, utility, or legal
// boilerplate rather than an article/event.
const NAV_TEXT = new Set([
  "home", "about", "about us", "contact", "contact us", "menu", "search",
  "login", "log in", "sign in", "sign up", "subscribe", "donate", "support us",
  "privacy", "privacy policy", "terms", "terms of service", "cookies",
  "calendar", "events", "all events", "see all", "view all", "read more",
  "newsletter", "facebook", "twitter", "instagram", "youtube", "rss",
  "hours", "location", "directions", "staff", "board", "careers", "jobs",
  "membership", "volunteer", "shop", "store", "blog", "news", "press",
  "library cards", "library card", "library of things", "computers & wifi",
  "computers and wifi", "wifi", "can\u2019t find what you need?", "help",
  "programs", "services", "resources", "kids", "teens", "adults",
]);

const NAV_URL_PARTS = [
  "/about", "/contact", "/privacy", "/terms", "/login", "/signin", "/subscribe",
  "/donate", "/careers", "/jobs", "/staff", "/hours", "/locations", "/membership",
  "/volunteer", "/search", "/cart", "/shop", "/account", "/sitemap", "/feed",
  "/rss", "/library-card", "/library-cards", "/library-of-things", "/computers",
  "/wifi", "/help",
];

function looksNav(text: string, href: string): boolean {
  const norm = text.toLowerCase().trim().replace(/\s+/g, " ");
  if (NAV_TEXT.has(norm)) return true;
  // Very short capitalized words are usually nav chrome.
  if (norm.split(" ").length < 3 && norm.length < 24) return true;
  const lowerHref = href.toLowerCase();
  for (const p of NAV_URL_PARTS) if (lowerHref.endsWith(p) || lowerHref.endsWith(p + "/")) return true;
  return false;
}

function genericArticleParser(html: string, source: Source): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href="([^"#?]+)"[^>]*>([^<]{12,160})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < 10) {
    let href = m[1].trim();
    const text = stripHtml(m[2]);
    if (!text) continue;
    if (href.startsWith("/")) {
      try {
        const u = new URL(source.url);
        href = `${u.origin}${href}`;
      } catch {
        continue;
      }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    if (looksNav(text, href)) continue;
    // Require an article/event-ish path: either /news/, /events/, /post/,
    // /blog/, /announcement/, or a date segment (YYYY or YYYY/MM).
    try {
      const u = new URL(href);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length < 2) continue;
      const path = u.pathname.toLowerCase();
      const articleish =
        path.includes("/news/") ||
        path.includes("/events/") ||
        path.includes("/event/") ||
        path.includes("/post/") ||
        path.includes("/blog/") ||
        path.includes("/announcement") ||
        path.includes("/story/") ||
        path.includes("/press/") ||
        /\/20\d{2}\//.test(path);
      if (!articleish) continue;
    } catch {
      continue;
    }
    seen.add(href);
    items.push({ title: text, url: href });
  }
  return items;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Use a normal browser User-Agent. Many event sites (Eventbrite, etc.)
    // 403 / 406 any non-browser UA. We still self-identify in Accept-Language
    // and only fetch publicly-served HTML, no scraping behind login walls.
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export const htmlFetcher: Fetcher = {
  async fetch(source, opts): Promise<FetchResult> {
    const timeoutMs = opts?.timeoutMs ?? 7000;
    const parserKey = source.parserKey ?? "";
    // For calendar-category sources with no explicit parser, fall back to the
    // generic JSON-LD event extractor. Most venue ticketing pages publish
    // schema.org Event blocks that we can extract without per-site code.
    const resolvedKey = parserKey
      || (source.category === "calendars" ? "json-ld" : "");
    const parser = PARSERS[resolvedKey];
    // Use source.url as the page to fetch when no explicit feedUrl is set
    // (typical for HTML venue pages).
    const fetchUrl = source.feedUrl || source.url;
    if (!fetchUrl || !parser) {
      return { mode: "mock", items: loadFixture(source), error: "no parser configured" };
    }
    try {
      const res = await fetchWithTimeout(fetchUrl, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Parsers may be sync OR async (e.g. two-stage parsers that follow
      // listing pages to event detail pages). Awaiting works for both.
      const items = await parser(html, source);
      if (items.length === 0) {
        return { mode: "mock", items: loadFixture(source), error: "parser produced 0 items" };
      }
      return { mode: "live", items };
    } catch (err: any) {
      return { mode: "mock", items: loadFixture(source), error: err?.message ?? String(err) };
    }
  },
};
