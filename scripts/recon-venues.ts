/**
 * Recon script: probes a list of candidate venue URLs and figures out the
 * best ingest strategy for each one.
 *
 * For each URL, we:
 *   1. Fetch the homepage with a desktop UA.
 *   2. Look for: an events page link, a Facebook page link, a Tribe Events
 *      / WP The Events Calendar RSS feed (`/events/feed/`), and a
 *      ticketing-platform host (Etix, Eventbrite, etc).
 *   3. If we find an events listing, fetch one detail page and check
 *      whether it embeds schema.org Event JSON-LD.
 *
 * Output: a JSON summary per URL classifying it as `rss_then_jsonld` |
 * `html_jsonld_list` | `facebook_text` | `manual_review`. Plus the
 * Facebook slug when we can find one, and the ticketing platform if any.
 *
 * Usage: tsx scripts/recon-venues.ts
 */
import "dotenv/config";

interface Candidate {
  cityId: number;
  citySlug: string;
  id: string;
  name: string;
  url: string;
}

// 30+ Montana venues to recon. cityId mapping:
//   1 missoula, 2 billings, 3 greatfalls, 4 bozeman, 5 butte,
//   6 helena, 7 kalispell, 8 havre, 9 whitefish, 10 laurel
const CANDIDATES: Candidate[] = [
  // ---- Billings (2) ----
  { cityId: 2, citySlug: "billings", id: "albertabair",      name: "Alberta Bair Theater",     url: "https://albertabairtheater.org/" },
  { cityId: 2, citySlug: "billings", id: "babcock",          name: "Babcock Theatre",          url: "https://babcocktheatre.com/" },
  { cityId: 2, citySlug: "billings", id: "pubstation",       name: "The Pub Station",          url: "https://www.pubstation.com/" },
  { cityId: 2, citySlug: "billings", id: "yam",              name: "Yellowstone Art Museum",   url: "https://www.artmuseum.org/" },
  { cityId: 2, citySlug: "billings", id: "billings-library", name: "Billings Public Library",  url: "https://billingslibrary.org/" },

  // ---- Missoula (1) ----
  { cityId: 1, citySlug: "missoula", id: "wilma",            name: "The Wilma",                url: "https://www.logjampresents.com/the-wilma" },
  { cityId: 1, citySlug: "missoula", id: "tophat",           name: "Top Hat Lounge",           url: "https://www.logjampresents.com/top-hat" },
  { cityId: 1, citySlug: "missoula", id: "kettlehouse-amp",  name: "KettleHouse Amphitheater", url: "https://www.logjampresents.com/kettlehouse-amphitheater" },
  { cityId: 1, citySlug: "missoula", id: "roxy",             name: "Roxy Theater",             url: "https://theroxytheater.org/" },
  { cityId: 1, citySlug: "missoula", id: "zacc",             name: "Zootown Arts Community Center", url: "https://zootownarts.org/" },
  { cityId: 1, citySlug: "missoula", id: "missoula-library", name: "Missoula Public Library",  url: "https://missoulapubliclibrary.org/" },

  // ---- Bozeman (4) ----
  { cityId: 4, citySlug: "bozeman",  id: "elm",              name: "The ELM",                  url: "https://logjampresents.com/the-elm" },
  { cityId: 4, citySlug: "bozeman",  id: "emerson",          name: "Emerson Center",           url: "https://www.theemerson.org/" },
  { cityId: 4, citySlug: "bozeman",  id: "rialto",           name: "The Rialto Bozeman",       url: "https://rialtobozeman.com/" },
  { cityId: 4, citySlug: "bozeman",  id: "bozeman-library",  name: "Bozeman Public Library",   url: "https://bozemanlibrary.org/" },

  // ---- Helena (6) ----
  { cityId: 6, citySlug: "helena",   id: "helena-civic",     name: "Helena Civic Center",      url: "https://helenaciviccenter.com/" },
  { cityId: 6, citySlug: "helena",   id: "myrna-loy",        name: "The Myrna Loy",            url: "https://themyrnaloy.com/" },
  { cityId: 6, citySlug: "helena",   id: "helena-library",   name: "Lewis & Clark Library",    url: "https://lclibrary.org/" },

  // ---- Great Falls (3) ----
  { cityId: 3, citySlug: "greatfalls", id: "gf-civic",       name: "Mansfield Center for the Performing Arts", url: "https://www.mansfieldtheater.com/" },
  { cityId: 3, citySlug: "greatfalls", id: "gf-history",     name: "The History Museum",       url: "https://thehistorymuseum.com/" },
  { cityId: 3, citySlug: "greatfalls", id: "gf-library",     name: "Great Falls Public Library", url: "https://greatfallslibrary.org/" },

  // ---- Kalispell (7) ----
  { cityId: 7, citySlug: "kalispell", id: "kalispell-library", name: "ImagineIF Library Kalispell", url: "https://imagineiflibraries.org/" },
  { cityId: 7, citySlug: "kalispell", id: "fvcc-arts",       name: "FVCC Arts & Tech",         url: "https://www.fvcc.edu/" },

  // ---- Whitefish (9) ----
  { cityId: 9, citySlug: "whitefish", id: "whitefish-pac",   name: "Whitefish Performing Arts Center", url: "https://whitefishtheatreco.org/" },

  // ---- Butte (5) ----
  { cityId: 5, citySlug: "butte",    id: "mother-lode",      name: "Mother Lode Theatre",      url: "https://www.buttearts.org/" },
  { cityId: 5, citySlug: "butte",    id: "butte-library",    name: "Butte-Silver Bow Public Library", url: "https://buttepubliclibrary.info/" },

  // ---- Havre (8) ----
  { cityId: 8, citySlug: "havre",    id: "havre-library",    name: "Havre-Hill County Library", url: "https://havrelibrary.com/" },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface ReconResult {
  id: string;
  name: string;
  citySlug: string;
  url: string;
  status: "ok" | "no_homepage" | "no_events";
  eventsPath?: string;
  rssFeedUrl?: string;
  fbSlug?: string;
  ticketHost?: string;
  hasJsonLdOnDetail?: boolean;
  detailCount?: number;
  recommendedKind: "rss_then_jsonld" | "html_jsonld_list" | "facebook_text" | "manual_review" | "skip";
  note?: string;
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<{ status: number; html: string } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
      signal: ctl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    return { status: res.status, html: await res.text() };
  } catch {
    return null;
  }
}

const TICKET_HOSTS = [
  "etix.com",
  "seetickets.us",
  "axs.com",
  "ticketmaster.com",
  "livenation.com",
  "eventbrite.com",
  "prekindle.com",
  "tixr.com",
  "showclix.com",
  "brownpapertickets.com",
];

function findTicketHost(html: string): string | undefined {
  for (const h of TICKET_HOSTS) {
    if (new RegExp(`https?://[^"\\s]*${h.replace(/\./g, "\\.")}`).test(html)) return h;
  }
  return undefined;
}

function findFacebookSlug(html: string): string | undefined {
  // Match facebook.com/<slug>/ where slug isn't a known reserved word
  const re = /https?:\/\/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9.\-_]+)\/?/g;
  const reserved = new Set(["sharer", "tr", "plugins", "dialog", "pages", "events", "groups", "share", "login", "watch"]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (reserved.has(slug.toLowerCase())) continue;
    return slug;
  }
  return undefined;
}

function findEventsLink(html: string, baseUrl: string): string | undefined {
  const candidates = [
    /href="([^"]*\/events?\/?[^"]*)"/i,
    /href="([^"]*\/calendar\/?[^"]*)"/i,
    /href="([^"]*\/shows?\/?[^"]*)"/i,
    /href="([^"]*\/concerts?\/?[^"]*)"/i,
    /href="([^"]*\/upcoming\/?[^"]*)"/i,
    /href="([^"]*\/whats-on\/?[^"]*)"/i,
  ];
  for (const re of candidates) {
    const m = html.match(re);
    if (m) {
      try {
        return new URL(m[1], baseUrl).toString();
      } catch {
        // skip
      }
    }
  }
  return undefined;
}

function parseEventJsonLd(html: string): boolean {
  const blockRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    try {
      const p = JSON.parse(m[1].trim());
      const nodes: any[] = Array.isArray(p)
        ? p
        : p["@graph"] && Array.isArray(p["@graph"])
          ? p["@graph"]
          : [p];
      for (const n of nodes) {
        if (!n || typeof n !== "object") continue;
        const t = n["@type"];
        if (
          (typeof t === "string" && t.toLowerCase().includes("event")) ||
          (Array.isArray(t) && t.some((x: any) => typeof x === "string" && x.toLowerCase().includes("event")))
        ) {
          if (n.startDate || n.startsAt) return true;
        }
      }
    } catch {
      // skip
    }
  }
  return false;
}

/** Heuristically extract the first /event/... or /events/... detail link from an events listing page. */
function findDetailLinks(html: string, baseUrl: string, limit = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (!/\/event[s]?\//i.test(href)) continue;
    // Skip /events/ root, /events/feed, etc.
    if (/\/event[s]?\/?$/i.test(href) || /\/feed\b/.test(href) || /\?ical=/.test(href)) continue;
    try {
      href = new URL(href, baseUrl).toString().split("#")[0];
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= limit) break;
  }
  return out;
}

async function reconOne(c: Candidate): Promise<ReconResult> {
  const r: ReconResult = {
    id: c.id,
    name: c.name,
    citySlug: c.citySlug,
    url: c.url,
    status: "ok",
    recommendedKind: "manual_review",
  };

  const home = await fetchText(c.url);
  if (!home || home.status >= 400) {
    r.status = "no_homepage";
    r.note = `homepage status ${home?.status ?? "fetch-failed"}`;
    return r;
  }
  r.ticketHost = findTicketHost(home.html);
  r.fbSlug = findFacebookSlug(home.html);

  // Try a Tribe-style RSS feed first -- it's the strongest signal.
  const rssCandidates = [
    new URL("/events/feed/", c.url).toString(),
    new URL("/event/feed/", c.url).toString(),
    new URL("/calendar/feed/", c.url).toString(),
  ];
  for (const ru of rssCandidates) {
    const rss = await fetchText(ru, 8000);
    if (rss && rss.status === 200 && rss.html.includes("<item>") && rss.html.length > 500) {
      r.rssFeedUrl = ru;
      // Confirm JSON-LD on the first detail link in the feed
      const linkMatch = rss.html.match(/<item>[\s\S]*?<link>\s*([^<\s]+)\s*<\/link>/i);
      if (linkMatch) {
        const detail = await fetchText(linkMatch[1], 8000);
        if (detail && parseEventJsonLd(detail.html)) {
          r.hasJsonLdOnDetail = true;
          r.recommendedKind = "rss_then_jsonld";
          r.eventsPath = new URL("/events/", c.url).toString();
          return r;
        }
      }
      // RSS exists but detail doesn't have JSON-LD. Worth manual review.
      r.note = "rss feed exists but no JSON-LD on detail";
    }
  }

  // No RSS -- look for an events listing page on the homepage.
  const eventsUrl = findEventsLink(home.html, c.url);
  if (eventsUrl) {
    r.eventsPath = eventsUrl;
    const evPage = await fetchText(eventsUrl);
    if (evPage && evPage.status === 200) {
      const detailLinks = findDetailLinks(evPage.html, eventsUrl);
      r.detailCount = detailLinks.length;
      if (detailLinks.length > 0) {
        // Check JSON-LD on the first detail link
        const d0 = await fetchText(detailLinks[0]);
        if (d0 && parseEventJsonLd(d0.html)) {
          r.hasJsonLdOnDetail = true;
          r.recommendedKind = "html_jsonld_list";
          return r;
        }
      }
    }
  }

  // Fallback: do we have an FB slug we could use?
  if (r.fbSlug) {
    r.recommendedKind = "facebook_text";
    r.note = (r.note ?? "") + " (no usable website events -- using FB fallback)";
    return r;
  }

  r.status = "no_events";
  r.recommendedKind = "skip";
  r.note = (r.note ?? "") + " (no events path + no FB slug)";
  return r;
}

async function main() {
  console.log(`Reconning ${CANDIDATES.length} venues...\n`);
  // Parallelism = 6 to keep it polite and avoid hammering.
  const out: ReconResult[] = [];
  const queue = [...CANDIDATES];
  async function worker() {
    while (queue.length) {
      const c = queue.shift();
      if (!c) break;
      const r = await reconOne(c);
      out.push(r);
      console.log(`  ${r.citySlug.padEnd(12)} ${r.id.padEnd(22)} kind=${r.recommendedKind.padEnd(18)} ticketHost=${r.ticketHost ?? "-".padEnd(15)} fb=${r.fbSlug ?? "-"} ${r.note ?? ""}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  // Sort and summarize
  out.sort((a, b) => (a.citySlug.localeCompare(b.citySlug) || a.id.localeCompare(b.id)));
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/venue-recon.json", JSON.stringify(out, null, 2));
  console.log("\nWrote /tmp/venue-recon.json");
  const byKind: Record<string, number> = {};
  for (const r of out) byKind[r.recommendedKind] = (byKind[r.recommendedKind] ?? 0) + 1;
  console.log("By kind:", byKind);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
