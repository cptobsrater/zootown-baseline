import type { Source, InsertStory, Desk, Status, PoliticalScope } from "../../shared/schema.js";
import type { RawItem } from "./types.js";

/**
 * Canonicalize a URL for dedupe.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const toDelete: string[] = [];
    u.searchParams.forEach((_, key) => {
      const lk = key.toLowerCase();
      if (
        lk.startsWith("utm_") ||
        lk === "fbclid" ||
        lk === "gclid" ||
        lk.startsWith("mc_") ||
        lk === "ref" ||
        lk === "ref_src"
      ) {
        toDelete.push(key);
      }
    });
    for (const k of toDelete) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

// Valid desks for v2 (politics and science_tech retired — remapped at ingest)
const VALID_DESKS = new Set<Desk>([
  "city", "business", "crime", "sports", "health",
  "events", "people", "history",
]);

// Remap retired desks at ingest. Politics → city. Science/Tech → business.
function remapRetiredDesk(desk: string): Desk {
  if (desk === "politics") return "city";
  if (desk === "science_tech") return "business";
  return desk as Desk;
}

// Montana/Missoula geo-relevance signals
const GEO_SIGNALS = [
  "missoula", "montana", "mt.", ", mt", "griz", "grizzlies", "university of montana", "umt",
  "bozeman", "helena", "butte", "kalispell", "billings", "great falls", "hamilton", "stevensville",
  "lolo", "florence", "superior", "frenchtown", "bonner", "clinton",
  "clark fork", "bitterroot", "rattlesnake", "blackfoot",
  "daines", "tester", "gianforte", "zinke", "bullock", "rosendale",
  "missoulian", "kpax", "mtpr", "montana free press", "missoula current",
  "hellgate", "sentinel high", "big sky high", "loyola sacred heart",
  "flathead", "glacier county", "yellowstone county", "gallatin county", "ravalli county",
  "big sky", "whitefish", "polson", "havre", "miles city", "glendive", "sidney", "livingston",
];

// Bylines/datelines that almost always mean national wire content, NOT Montana-local
const NATIONAL_WIRE_MARKERS = [
  "(ap)", " — ap", "associated press", "reuters", "(afp)", "agence france", "bloomberg news",
  "washington (", "washington —", "new york (", "new york —", "los angeles (",
  "london (", "london —", "beijing (", "moscow (", "paris (", "berlin (",
  "-- ap", "by the associated press",
];

function hasGeoSignal(text: string): boolean {
  return GEO_SIGNALS.some((g) => text.includes(g));
}

function looksLikeNationalWire(text: string): boolean {
  return NATIONAL_WIRE_MARKERS.some((m) => text.includes(m));
}

function isLocalMontanaSource(source: Source): boolean {
  try {
    const host = new URL(source.url).hostname.toLowerCase();
    return (
      /missoula|missoulian|kpax|mtpr|montana|missoulacurrent|missoulaindependent|bozeman|flathead|helena|billings|kxlf|ktvq|kbzk|nbcmontana|montanapublicradio|montanafreepress|missoulaevents|logjam|destinationmissoula|gatherboard|griztix|zootown/.test(host)
    );
  } catch {
    return false;
  }
}

// Event sources that should always be classified as "events"
const EVENTS_SOURCES = [
  "logjam", "eventbrite", "ticketmaster", "destination missoula", "visit missoula",
  "gatherboard", "missoula events", "adams center", "griztix", "missoula county fairgrounds",
];

function isEventsSource(source: Source): boolean {
  const name = source.name.toLowerCase();
  return EVENTS_SOURCES.some((s) => name.includes(s));
}

/** Desk classifier — returns single Desk per story */
export function classifyDesk(item: RawItem, source: Source): Desk {
  // History desk is NEVER assigned by the predictor — only via the history pool
  const text = `${item.title} ${item.summary ?? ""} ${(item.categories ?? []).join(" ")}`.toLowerCase();

  // 1. Events: eventDate metadata OR events source
  if (item.eventDate || isEventsSource(source)) return "events";
  if (/\b(festival|concert|live music|open mic|art opening|gallery reception|community event|free event|join us|tickets available|doors open|rsvp|register now)\b/.test(text) &&
      isLocalMontanaSource(source)) return "events";

  // 2. People: profile/personality stories about named local figures
  if (/\b(profile|interview with|q&a|born and raised|in conversation with|meet the|a life in|longtime missoula|longtime montana|veteran missoula|veteran montana)\b/.test(text)) {
    if (hasGeoSignal(text) || isLocalMontanaSource(source)) return "people";
  }
  if (/\b(keila szpaller|steve daines profile|jon tester profile|greg gianforte profile|mike mansfield|ryan zinke profile)\b/.test(text)) return "people";

  // Build keyword scores
  const score: Partial<Record<Desk, number>> = {};
  const hit = (desk: Desk, kws: string[], weight = 1) => {
    for (const k of kws) {
      if (text.includes(k)) score[desk] = (score[desk] ?? 0) + weight;
    }
  };

  // Science & Tech — global allowed, no geo gate
  // Health — Montana-tie required (gated below)
  hit("health", [
    "public health", "county health", "missoula city-county health", "health department",
    "hospital", "st. patrick hospital", "community medical center", "providence", "clinic",
    "vaccine", "vaccination", "flu shot", "covid", "outbreak", "measles", "rsv",
    "smoke advisory", "air quality", "wildfire smoke", "heat advisory", "mental health",
    "suicide prevention", "opioid", "overdose", "narcan",
    "wellness", "fitness", "nutrition", "diabetes", "cancer screening", "mammogram",
    "blood drive", "organ donor", "telehealth", "medicare", "medicaid",
    "glp-1", "weight-loss drug", "obesity drug", "mrna", "alzheimer", "parkinson",
    "new treatment", "fda approval", "fda approves", "gene therapy",
  ], 2);

  // People — narrow: only obituaries and stories explicitly about a specific
  // local person (profile/interview/Q&A). Generic mentions of "local artist"
  // do not qualify; those should land on City or Business instead.
  hit("people", [
    "obituary", "obituaries", "in memoriam", "passed away", "funeral service",
    "died at", "died this week", "died monday", "died tuesday", "died wednesday",
    "died thursday", "died friday", "died saturday", "died sunday",
    "profile of", "q&a with", "in conversation with", "meet missoula\u2019s",
  ], 2);

  // Events — local events
  hit("events", [
    "festival", "concert", "live music", "open mic", "art opening", "gallery opening",
    "community event", "free event", "tickets", "doors open", "rsvp", "upcoming event",
    "this weekend", "tomorrow night", "this saturday", "this sunday", "tonight at",
    "logjam", "caras park", "adams center", "kettlehouse amphitheater",
    "missoula farmers market", "out to lunch", "river city roots", "brewfest",
  ]);

  // Crime / public safety
  hit("crime", [
    "arrest", "arrested", "charged with", "indicted", "suspect", "stabbing", "shooting",
    "homicide", "burglary", "robbery", "theft", "assault", "dui", "drug bust",
    "missing person", "amber alert", "search warrant", "sheriff", "missoula police",
    "police department", "court case", "trial", "verdict", "sentenced", "plea", "felony",
    "misdemeanor", "fugitive", "wanted", "standoff", "investigation",
  ], 2);

  // City / civic
  hit("city", [
    "city council", "mayor", "commissioner", "public hearing", "ordinance", "zoning",
    "planning", "budget", "fire department", "public works", "school board", "permit",
    "trustee", "wildfire", "weather alert", "flood", "housing", "affordable housing", "transit",
    "road closure", "paving", "infrastructure", "city of missoula", "missoula county",
  ]);

  // Business
  hit("business", [
    "business", "restaurant opening", "new restaurant", "cafe", "brewery opens", "shop opens",
    "store opens", "chamber of commerce", "economy", "jobs", "workforce", "startup",
    "coworking", "retail", "market report", "closes", "closing", "hiring", "layoffs",
    "economic development", "downtown business",
  ]);

  // Sports — Griz, high school, recreation
  hit("sports", [
    "griz", "grizzlies", "montana grizzlies", "montana griz", "griz football", "griz basketball",
    "lady griz", "big sky conference", "hellgate high", "sentinel high", "big sky high",
    "loyola sacred heart", "high school football", "high school basketball", "varsity",
    "playoff", "championship", "tournament", "matchup", "rivalry", "coach", "head coach",
    "score", "final score", "defeats", "upset", "recruit", "signing day", "all-american",
    "5k", "10k", "marathon", "triathlon", "missoula marathon", "trail run", "cycling race",
    "missoula maulers", "missoula paddleheads", "baseball", "softball", "volleyball",
    "hockey", "soccer match", "track meet", "cross country", "wrestling meet",
  ], 2);

  // Civic / political content used to be its own desk — now folded into "city".
  hit("city", [
    "missoula city council", "missoula county commission", "missoula mayor", "city council vote",
    "county commission vote", "mt legislature", "montana legislature", "montana house",
    "montana senate", "state legislature", "governor gianforte", "gianforte",
    "senator daines", "steve daines", "senator tester", "jon tester",
    "ryan zinke", "mt secretary of state", "helena politics",
    "ballot measure", "ballot initiative", "missoula election", "montana election",
    "local candidate", "missoula candidate", "missoula school board", "trustee election",
    "primary election", "general election", "polling place", "voter registration",
    "missoula ward", "county seat", "legislative session",
  ]);

  // --- Apply geo gate ---
  // EVERY desk requires a Montana/Missoula tie. There are no global desks.
  const geoGatedDesks: Desk[] = ["city", "business", "crime", "sports", "health", "events", "people", "history"];
  const hasTextSignal = hasGeoSignal(text);
  const fromLocalSource = isLocalMontanaSource(source);
  const wireMarker = looksLikeNationalWire(text);

  // Crime is strictest: requires in-text Montana signal AND no national-wire marker.
  const isLocalForCrime = hasTextSignal && !wireMarker;
  // Other desks: text signal OR source domain, but wire markers still disqualify.
  const isLocal = (hasTextSignal || fromLocalSource) && !wireMarker;

  if (!isLocalForCrime) score["crime"] = 0;
  if (!isLocal) {
    for (const d of geoGatedDesks) {
      if (d === "crime") continue;
      score[d] = 0;
    }
  }

  // Find highest scoring desk
  let bestDesk: Desk | null = null;
  let bestScore = 0;
  for (const [d, s] of Object.entries(score) as [Desk, number][]) {
    if (VALID_DESKS.has(d) && s > bestScore) {
      bestDesk = d;
      bestScore = s;
    }
  }

  // If we have a winner, return it
  if (bestDesk && bestScore > 0) return bestDesk;

  // TIEBREAK: use categoryPriority from source
  if (source.categoryPriority) {
    try {
      const priority: string[] = JSON.parse(source.categoryPriority);
      for (const d of priority) {
        if (VALID_DESKS.has(d as Desk)) return d as Desk;
      }
    } catch {}
  }

  // Source desks fallback
  try {
    const desks: string[] = JSON.parse(source.desks || "[]");
    for (const d of desks) {
      if (VALID_DESKS.has(d as Desk)) {
        // Only return geo-gated desks if local
        if (geoGatedDesks.includes(d as Desk) && !isLocal) continue;
        return d as Desk;
      }
    }
  } catch {}

  // Default
  if (isLocal) return "city";

  // Non-local with no classification → reject in caller
  return "city";
}

/**
 * Returns true if a story should be rejected because it has no local relevance
 * and isn't in a global-allowed desk (health, science_tech).
 */
export function shouldRejectAsNonLocal(item: RawItem, source: Source, assignedDesk: Desk): boolean {
  const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const hasTextSignal = hasGeoSignal(text);
  const wireMarker = looksLikeNationalWire(text);
  if (wireMarker) return true;
  if (assignedDesk === "crime") return !hasTextSignal;
  if (hasTextSignal || isLocalMontanaSource(source)) return false;
  return true;
}

/**
 * Infer the political scope of a story when desk === "politics".
 */
export function inferPoliticalScope(item: RawItem, source: Source): PoliticalScope {
  const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const host = (() => {
    try { return new URL(item.url).hostname.toLowerCase(); } catch { return ""; }
  })();
  const sourceHost = (() => {
    try { return new URL(source.url).hostname.toLowerCase(); } catch { return ""; }
  })();

  const nationalHits = [
    "president", "white house", "congress", "u.s. senate", "us senate", "u.s. house", "us house",
    "supreme court", "federal election", "washington, d.c.", "washington dc",
    "biden", "trump", "harris", "house republicans", "house democrats",
  ];
  if (nationalHits.some((k) => text.includes(k))) return "national";

  const stateHits = [
    "helena", "state legislature", "state senate", "state house", "state representative",
    "governor gianforte", "governor", "attorney general", "secretary of state",
    "montana supreme court", "public service commission", "state capitol", "legislative session",
    "montana house", "montana senate", "legislature",
  ];
  if (stateHits.some((k) => text.includes(k))) return "state";

  const localHits = [
    "missoula city council", "city council", "missoula county", "county commission",
    "mayor", "school board", "trustee", "local candidate", "local election",
    "missoula mayor", "city of missoula", "missoula elections",
  ];
  if (localHits.some((k) => text.includes(k))) return "local";

  if (/missoula|zootown|mtpr\.org/.test(host) || /missoula|zootown/.test(sourceHost)) return "local";
  if (/\.mt\.gov/.test(host) || /montana/i.test(text)) return "state";
  return "national";
}

const TAG_KEYWORDS: Record<string, string[]> = {
  "city-council": ["city council", "council"],
  "county": ["county", "commissioner"],
  "housing": ["housing", "affordable housing", "rent"],
  "transportation": ["parking", "transit", "roads", "paving", "russell street"],
  "downtown": ["downtown", "higgins"],
  "public-safety": ["fire department", "police", "wildfire", "fire season"],
  "environment": ["clark fork", "river", "environment", "cleanup", "wildflower"],
  "education": ["school", "mcps", "students", "university", "griz"],
  "business": ["business", "chamber", "workforce", "economy"],
  "restaurant": ["restaurant", "cafe", "brewery", "brewfest", "food"],
  "music": ["music", "concert", "band", "headliner", "festival"],
  "arts": ["art", "arts", "exhibit", "gallery", "residency"],
  "events": ["festival", "event", "out to lunch", "brewfest"],
  "library": ["library"],
  "elections": ["election", "candidate", "trustee"],
  "griz": ["griz", "grizzlies", "lady griz"],
  "science": ["research", "study", "nasa", "satellite"],
  "tech": ["ai ", "artificial intelligence", "chip", "model"],
};

export function autoTag(item: RawItem): string[] {
  const text = `${item.title} ${item.summary ?? ""} ${(item.categories ?? []).join(" ")}`.toLowerCase();
  const tags = new Set<string>();
  for (const [tag, kws] of Object.entries(TAG_KEYWORDS)) {
    if (kws.some((k) => text.includes(k))) tags.add(tag);
  }
  for (const c of item.categories ?? []) {
    const t = c.toLowerCase().trim().replace(/\s+/g, "-");
    if (t && t.length <= 24) tags.add(t);
  }
  return Array.from(tags).slice(0, 6);
}

export function inferLocation(item: RawItem): string | null {
  const text = `${item.title} ${item.summary ?? ""}`;
  const patterns: Array<[RegExp, string]> = [
    [/downtown/i, "Downtown Missoula"],
    [/caras park/i, "Caras Park"],
    [/rattlesnake/i, "Rattlesnake"],
    [/clark fork/i, "Clark Fork"],
    [/higgins/i, "Higgins Ave"],
    [/russell street/i, "Russell Street"],
    [/fairgrounds/i, "Fairgrounds"],
    [/mount sentinel|\bsentinel\b/i, "Mount Sentinel"],
    [/zacc/i, "ZACC"],
    [/north higgins/i, "North Higgins"],
    [/kettlehouse/i, "KettleHouse Amphitheater"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(text)) return label;
  }
  return null;
}

export function pickStatus(item: RawItem): Status | null {
  const text = `${item.title} ${(item.categories ?? []).join(" ")}`.toLowerCase();
  if (/festival|concert|event|brewfest|market/.test(text)) return "Event";
  if (/developing|breaking|unverified/.test(text)) return "Developing";
  if (/update/.test(text)) return "Updated";
  return "New";
}

export function isOpinionContent(item: RawItem): boolean {
  const text = `${item.title} ${(item.categories ?? []).join(" ")}`.toLowerCase();
  return /\b(opinion|op-ed|op\sed|editorial|commentary|letter to the editor|my turn|guest column|endorsement editorial)\b/.test(text);
}

export function isJobPosting(item: RawItem): boolean {
  const text = `${item.title} ${(item.categories ?? []).join(" ")}`.toLowerCase();
  if (/\bnow hiring\b|\bjob opening\b|\bjob posting\b|\bapply now\b|\bcareers?\b/.test(text)) return true;
  if (/\b-\b[^-]{2,40}\b-\b\s*[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(item.title)) return true;
  try {
    const host = new URL(item.url).hostname.toLowerCase();
    if (/indeed\.com|ziprecruiter\.com|jobs\.mt\.gov|monster\.com|linkedin\.com\/jobs/.test(host)) return true;
  } catch {}
  return false;
}

export function isClassified(item: RawItem): boolean {
  const text = `${item.title} ${(item.categories ?? []).join(" ")}`.toLowerCase();
  return /\b(for sale|garage sale|estate sale|classified|real estate listing|home for sale|house for sale|land for sale|condo for sale|mls #?\d+)\b/.test(text);
}

export function isStale(item: RawItem, maxAgeDays = 14): boolean {
  if (!item.publishedAt) return false;
  const t = Date.parse(item.publishedAt);
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

export function shouldSkipItem(item: RawItem, _source: Source): string | null {
  if (isOpinionContent(item)) return "opinion";
  if (isJobPosting(item)) return "job_posting";
  if (isClassified(item)) return "classified";
  if (isStale(item, 14)) return "stale";
  const summary = (item.summary ?? "").trim();
  if (!summary && item.title.length < 24) return "low_quality";
  return null;
}

function truncateSummary(s: string, max = 260): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1);
  return cut.trim() + "\u2026";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; } })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026");
}

export function toInsertStory(item: RawItem, source: Source): InsertStory {
  const canonical = canonicalizeUrl(item.url);
  const publishedAt = item.publishedAt ?? new Date().toISOString();
  const title = decodeEntities(item.title).trim();
  const rawSummary = decodeEntities((item.summary ?? item.title).replace(/\s+/g, " ").trim());
  const summary = truncateSummary(rawSummary);
  const desk = remapRetiredDesk(classifyDesk({ ...item, title }, source));
  const politicalScope = null; // politics desk retired
  const modState = shouldRejectAsNonLocal(item, source, desk) ? "rejected" : "approved";
  return {
    headline: title,
    summary,
    whyItMatters: null,
    desk,
    tags: JSON.stringify(autoTag({ ...item, title })),
    sourceName: source.name,
    sourceUrl: canonical,
    sourceType: source.sourceType,
    publishedAt,
    fetchedAt: new Date().toISOString(),
    location: inferLocation(item),
    status: pickStatus(item),
    riskLevel: "low",
    isSeeded: false,
    modState,
    politicalScope,
    eventDate: item.eventDate ?? null,
  };
}
