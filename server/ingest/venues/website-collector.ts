/**
 * Website-first venue event collector (Phase 14).
 *
 * Pulls a venue's official events listing -- either an RSS feed or a plain
 * HTML index page -- and resolves each entry into a `RawVenueEvent` by
 * fetching the detail page and parsing its schema.org JSON-LD Event block.
 *
 * This is the strongest possible signal we have: the venue itself,
 * structured data, with the actual ticket URL in offers.url. Everything
 * else (Facebook, classifier guesses) is secondary to what comes out of
 * this collector.
 *
 * We deliberately do NOT use Cloudflare Browser Rendering here. Venue
 * sites are real websites; plain fetch with a desktop UA works.
 */
import type { CuratedVenue } from "./curated-venues.js";
import { isTicketHost } from "./curated-venues.js";

export interface RawVenueEvent {
  /** Event name as published by the venue. */
  title: string;
  /** ISO-8601 string with timezone offset (preserved verbatim from JSON-LD). */
  startsAt: string;
  /** Optional end time (some venues publish ranges; the JSON-LD endDate). */
  endsAt?: string | null;
  /** Detail page URL on the venue's site. Always set for website-source events. */
  detailUrl: string;
  /** Ticket URL extracted from offers.url, if any. */
  ticketUrl?: string | null;
  /** Long-form description text (HTML stripped). */
  description?: string | null;
  /** Venue place name as published (often the same string for all events). */
  location?: string | null;
  /** Image URL if present. */
  image?: string | null;
  /** Where we found it: "rss_then_jsonld" | "html_jsonld_list". */
  via: "rss_then_jsonld" | "html_jsonld_list";
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { "user-agent": DESKTOP_UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
      signal: ctl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Tiny RSS item extractor -- we only need <link> URLs, not full feed parsing. */
function extractRssLinks(rssXml: string, detailLinkContains?: string): string[] {
  const links: string[] = [];
  // Matches <link>...</link> inside <item> blocks. Naive but works on
  // standard RSS 2.0 (the format every WP site emits).
  const itemMatches = rssXml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const item of itemMatches) {
    const m = item.match(/<link>\s*([^<\s]+)\s*<\/link>/i);
    if (!m) continue;
    const url = m[1].trim();
    if (detailLinkContains && !url.includes(detailLinkContains)) continue;
    links.push(url);
  }
  return Array.from(new Set(links));
}

/** Extract /event/... hrefs from an HTML listing page. */
function extractHtmlEventLinks(html: string, baseUrl: string, detailLinkContains = "/event/"): string[] {
  const links = new Set<string>();
  const re = /href=\"([^\"]+)\"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (!href.includes(detailLinkContains)) continue;
    try {
      href = new URL(href, baseUrl).toString();
      // Strip query strings / fragments to canonicalize.
      href = href.split("#")[0];
      links.add(href);
    } catch {
      // skip
    }
  }
  return Array.from(links);
}

/** Decode the small set of HTML entities we see in JSON-LD titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201c")
    .replace(/&#8221;/g, "\u201d")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ");
}

/**
 * Pull the first schema.org Event JSON-LD block out of a detail page.
 * Handles both bare {@type:Event} payloads and @graph-wrapped variants.
 */
function parseEventJsonLd(html: string): {
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string;
  description?: string;
  locationName?: string;
  offersUrl?: string;
} | null {
  const blockRe = /<script[^>]*type=\"application\/ld\+json\"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const raw = m[1].trim();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates: any[] = [];
    if (Array.isArray(parsed)) candidates.push(...parsed);
    else if (parsed["@graph"] && Array.isArray(parsed["@graph"])) candidates.push(...parsed["@graph"]);
    else candidates.push(parsed);

    for (const node of candidates) {
      if (!node || typeof node !== "object") continue;
      const t = node["@type"];
      const typeMatches = Array.isArray(t)
        ? t.some((x: any) => typeof x === "string" && x.toLowerCase().includes("event"))
        : typeof t === "string" && t.toLowerCase().includes("event");
      if (!typeMatches) continue;

      const offers = node.offers;
      const offersUrl =
        offers && (Array.isArray(offers) ? offers[0]?.url : offers.url)
          ? Array.isArray(offers)
            ? offers[0].url
            : offers.url
          : undefined;
      const loc = node.location;
      const locationName =
        typeof loc === "string"
          ? loc
          : loc && typeof loc === "object"
            ? loc.name ?? (typeof loc.address === "string" ? loc.address : undefined)
            : undefined;

      return {
        name: typeof node.name === "string" ? decodeEntities(node.name) : undefined,
        startDate: typeof node.startDate === "string" ? node.startDate : undefined,
        endDate: typeof node.endDate === "string" ? node.endDate : undefined,
        url: typeof node.url === "string" ? node.url : undefined,
        image: typeof node.image === "string" ? node.image : Array.isArray(node.image) ? node.image[0] : undefined,
        description:
          typeof node.description === "string" ? decodeEntities(node.description).slice(0, 2000) : undefined,
        locationName: locationName ? decodeEntities(locationName) : undefined,
        offersUrl,
      };
    }
  }
  return null;
}

/**
 * Collect events from a curated venue's website. Returns an empty array on
 * any source-level failure (fetch fails, no events found, etc.) so the
 * caller can fall back to Facebook or simply skip this venue for the day.
 */
export async function collectFromVenueWebsite(venue: CuratedVenue): Promise<RawVenueEvent[]> {
  const src = venue.websiteSource;
  if (!src) return [];
  if (src.kind === "facebook_text") return []; // handled by the FB collector
  const list = await fetchText(src.listUrl);
  if (!list) return [];

  // Step 1: get detail-page URLs.
  let detailUrls: string[] = [];
  if (src.kind === "rss_then_jsonld") {
    detailUrls = extractRssLinks(list, src.detailLinkContains);
  } else {
    detailUrls = extractHtmlEventLinks(list, src.listUrl, src.detailLinkContains ?? "/event/");
  }

  // Cap at 60 -- a single venue dumping hundreds of links is a bad signal
  // and we don't want to hammer their server.
  detailUrls = detailUrls.slice(0, 60);

  // Step 2: fetch each detail page and pull the JSON-LD Event.
  // Concurrency capped at 4 to keep us polite.
  const out: RawVenueEvent[] = [];
  const queue = [...detailUrls];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      const html = await fetchText(url);
      if (!html) continue;
      const ld = parseEventJsonLd(html);
      if (!ld || !ld.startDate || !ld.name) continue;

      // ticketUrl: prefer offers.url IFF it looks like a ticket host.
      // If offers.url is e.g. the venue's own page back at itself (a
      // bookkeeping artifact), we ignore it -- the detail page itself
      // becomes the link.
      const ticketUrl = ld.offersUrl && isTicketHost(ld.offersUrl) ? ld.offersUrl : null;

      out.push({
        title: ld.name,
        startsAt: ld.startDate,
        endsAt: ld.endDate ?? null,
        detailUrl: ld.url ?? url,
        ticketUrl,
        description: ld.description ?? null,
        location: ld.locationName ?? null,
        image: ld.image ?? null,
        // src.kind narrowed away from "facebook_text" by the early return
        // above, so this cast is sound.
        via: src.kind as "rss_then_jsonld" | "html_jsonld_list",
      });
    }
  });
  await Promise.all(workers);
  return out;
}
