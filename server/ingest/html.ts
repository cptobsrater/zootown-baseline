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

const PARSERS: Record<string, (html: string, source: Source) => RawItem[]> = {
  "destination-missoula": genericArticleParser,
  "downtown-partnership": genericArticleParser,
  "fairgrounds": genericArticleParser,
  "chamber": genericArticleParser,
  "library": genericArticleParser,
  "zacc": genericArticleParser,
  "missoula-events": missoulaEventsParser,
  "logjam": logjamParser,
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
  while ((m = blockRe.exec(html)) !== null && items.length < 60) {
    let parsed: any;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    // JSON-LD can be a single object, an array, or a @graph wrapper.
    const stack: any[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (stack.length) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      const t = node["@type"];
      const isEvent =
        t === "Event" ||
        t === "MusicEvent" ||
        t === "TheaterEvent" ||
        t === "SportsEvent" ||
        t === "Festival" ||
        (Array.isArray(t) && t.some((x) => /Event/i.test(String(x))));
      if (!isEvent) continue;
      const title = (node.name ?? "").toString().trim();
      const startDate = (node.startDate ?? node.start ?? "").toString().trim();
      const url = (node.url ?? node["@id"] ?? source.url ?? "").toString().trim();
      if (!title || !startDate || !url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      // Build a summary from venue + description if available
      const venue = typeof node.location === "object"
        ? (node.location.name ?? node.location["@name"] ?? null)
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
  }
  return items;
}

/** Logjam Presents — Missoula concert promoter. Events live at /event/<slug> */
function logjamParser(html: string, source: Source): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  // Match anchors to /event/<slug>. Capture surrounding HTML for date/venue extraction.
  const re = /<a[^>]+href="(https?:\/\/(?:www\.)?logjampresents\.com\/event\/[^"#?]+|\/event\/[^"#?]+)"[^>]*>([\s\S]{1,400}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < 30) {
    const href = m[1].trim();
    const inner = m[2];
    const title = stripHtml(inner);
    if (!title || title.length < 4 || title.length > 220) continue;
    if (looksNav(title, href)) continue;
    let fullUrl: string;
    try {
      const base = new URL(source.url);
      fullUrl = href.startsWith("http") ? href : `${base.origin}${href}`;
    } catch {
      continue;
    }
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    // Look in a 600-char window after this anchor for a date string and venue.
    const tailStart = m.index + m[0].length;
    const tail = html.slice(tailStart, tailStart + 800);
    const dateMatch = tail.match(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^,<]{0,4},?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:[,\s]+\d{4})?/i,
    );
    const venueMatch = tail.match(
      /(Wilma|Top\s*Hat|ELM|KettleHouse|Kettlehouse\s+Amphitheater|Monk['’]s\s+Bar|Stage\s*112|Big\s*Sky\s*Brewing|Caras\s+Park)/i,
    );
    const summaryParts: string[] = [];
    if (dateMatch) summaryParts.push(dateMatch[0].replace(/\s+/g, " ").trim());
    if (venueMatch) summaryParts.push(venueMatch[0].replace(/\s+/g, " ").trim());
    items.push({
      title,
      url: fullUrl,
      categories: ["Event"],
      summary: summaryParts.length ? summaryParts.join(" · ") : undefined,
    });
  }
  if (items.length === 0) return genericArticleParser(html, source);
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
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ZooTown/0.1 (+https://zootown.pplx.app; aggregator-prototype)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
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
      const items = parser(html, source);
      if (items.length === 0) {
        return { mode: "mock", items: loadFixture(source), error: "parser produced 0 items" };
      }
      return { mode: "live", items };
    } catch (err: any) {
      return { mode: "mock", items: loadFixture(source), error: err?.message ?? String(err) };
    }
  },
};
