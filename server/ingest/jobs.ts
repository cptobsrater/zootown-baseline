import { XMLParser } from "fast-xml-parser";
import { fetchZipRecruiterJobs, type RawJob } from "./headless";

/**
 * Jobs aggregation — pulls live job postings from Indeed RSS, ZipRecruiter (headless),
 * and Montana JobLink (HTML). Results are merged + deduped + cached in memory for 30
 * minutes. We never copy job descriptions; only title, company, location, post-date,
 * and the link out.
 */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function fetchWithTimeout(url: string, timeoutMs = 9000, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/* ----------------- Indeed (RSS) ----------------- */
// Indeed exposes an RSS endpoint per search. format= is no longer required but we keep it.
// Example: https://www.indeed.com/rss?q=server&l=Missoula%2C+MT
export async function fetchIndeedJobs(query: string, location = "Missoula, MT"): Promise<RawJob[]> {
  const q = encodeURIComponent(query || "");
  const l = encodeURIComponent(location);
  const url = `https://www.indeed.com/rss?q=${q}&l=${l}&radius=25&sort=date`;
  try {
    const res = await fetchWithTimeout(url, 9000, {
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const doc = xmlParser.parse(xml);
    const items = doc?.rss?.channel?.item ?? [];
    const arr = Array.isArray(items) ? items : [items];
    const jobs: RawJob[] = [];
    for (const it of arr) {
      const title = String(it?.title ?? "").trim();
      const link = String(it?.link ?? "").trim();
      const desc = String(it?.description ?? "").trim();
      const pubDate = String(it?.pubDate ?? "").trim();
      if (!title || !link) continue;

      // Indeed titles are formatted: "Job Title - Company - Location"
      const parts = title.split(" - ").map((p) => p.trim());
      const jobTitle = parts[0] ?? title;
      const company = parts[1] ?? "";
      const loc = parts[2] ?? location;

      jobs.push({
        title: jobTitle,
        company,
        location: loc,
        url: link,
        postedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        source: "indeed",
      });
    }
    return jobs;
  } catch {
    return [];
  }
}

/* ----------------- Montana JobLink (HTML) ----------------- */
// Public job search at https://montanaworks.gov  (Montana JobLink consumer URL).
// Fall back gracefully if the markup changes — we just return [].
export async function fetchMontanaJobLinkJobs(query: string, location = "Missoula"): Promise<RawJob[]> {
  const q = encodeURIComponent(query || "");
  const l = encodeURIComponent(location);
  // MT JobLink has a public consumer search page. Use a generic search endpoint.
  const url = `https://www.jobs.mt.gov/jobs/search?q=${q}&location=${l}`;
  try {
    const res = await fetchWithTimeout(url, 9000, { Accept: "text/html" });
    if (!res.ok) return [];
    const html = await res.text();
    // Light regex extraction — matches list item anchors with job titles
    const jobs: RawJob[] = [];
    const seen = new Set<string>();
    const cardRe = /<a[^>]+href="(\/jobs\/[^"]+)"[^>]*>([^<]{8,180})<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = cardRe.exec(html)) !== null && jobs.length < 40) {
      const href = m[1];
      const titleRaw = m[2].trim().replace(/\s+/g, " ");
      if (!titleRaw || /search|filter|sort|login|register|home|contact/i.test(titleRaw)) continue;
      if (titleRaw.length < 8) continue;
      const fullUrl = `https://www.jobs.mt.gov${href}`;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      jobs.push({
        title: titleRaw,
        company: "",
        location: "Missoula, MT",
        url: fullUrl,
        source: "montana_joblink",
      });
    }
    return jobs;
  } catch {
    return [];
  }
}

/* ----------------- Aggregator with cache ----------------- */
type CacheKey = string;
interface CacheEntry { fetchedAt: number; jobs: RawJob[] }
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<CacheKey, CacheEntry>();

function cacheKey(query: string, sources: string[]) {
  return `${query.toLowerCase().trim()}::${[...sources].sort().join(",")}`;
}

export interface JobsQuery {
  q?: string;
  sources?: Array<"indeed" | "ziprecruiter" | "montana_joblink">;
  companies?: string[];
}

function dedupe(jobs: RawJob[]): RawJob[] {
  const seen = new Set<string>();
  const out: RawJob[] = [];
  for (const j of jobs) {
    // Dedupe on (title + company + location) lowercased — same listing reposted across sites
    const key = `${j.title.toLowerCase()}|${j.company.toLowerCase()}|${j.location.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

export async function getJobs(opts: JobsQuery = {}): Promise<{ jobs: RawJob[]; fetchedAt: string; cached: boolean; sources: string[] }> {
  const q = (opts.q ?? "").trim();
  const sources = opts.sources ?? ["indeed", "ziprecruiter", "montana_joblink"];
  const key = cacheKey(q, sources);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_MS) {
    let jobs = cached.jobs;
    if (opts.companies && opts.companies.length > 0) {
      const wanted = new Set(opts.companies.map((c) => c.toLowerCase()));
      jobs = jobs.filter((j) => wanted.has(j.company.toLowerCase()));
    }
    return { jobs, fetchedAt: new Date(cached.fetchedAt).toISOString(), cached: true, sources };
  }

  const tasks: Promise<RawJob[]>[] = [];
  if (sources.includes("indeed")) tasks.push(fetchIndeedJobs(q));
  if (sources.includes("ziprecruiter")) tasks.push(fetchZipRecruiterJobs(q));
  if (sources.includes("montana_joblink")) tasks.push(fetchMontanaJobLinkJobs(q));

  const results = await Promise.allSettled(tasks);
  const merged: RawJob[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  // Sort: most-recent first, then alpha
  merged.sort((a, b) => {
    const at = a.postedAt ? Date.parse(a.postedAt) : 0;
    const bt = b.postedAt ? Date.parse(b.postedAt) : 0;
    if (at !== bt) return bt - at;
    return a.title.localeCompare(b.title);
  });
  const deduped = dedupe(merged);
  cache.set(key, { fetchedAt: now, jobs: deduped });

  let jobs = deduped;
  if (opts.companies && opts.companies.length > 0) {
    const wanted = new Set(opts.companies.map((c) => c.toLowerCase()));
    jobs = jobs.filter((j) => wanted.has(j.company.toLowerCase()));
  }

  return { jobs, fetchedAt: new Date(now).toISOString(), cached: false, sources };
}

/* ----------------- Curated local employers + auto-detected hiring ----------------- */
// Hand-picked anchors — major Missoula-area employers we always want to know about.
export const CURATED_EMPLOYERS: Array<{ name: string; sector: string }> = [
  { name: "University of Montana", sector: "Education" },
  { name: "St. Patrick Hospital", sector: "Healthcare" },
  { name: "Community Medical Center", sector: "Healthcare" },
  { name: "Providence", sector: "Healthcare" },
  { name: "Missoula County", sector: "Government" },
  { name: "City of Missoula", sector: "Government" },
  { name: "Missoula County Public Schools", sector: "Education" },
  { name: "Logjam Presents", sector: "Hospitality" },
  { name: "Liquid Planet", sector: "Hospitality" },
  { name: "Big Dipper", sector: "Hospitality" },
  { name: "Bayern Brewing", sector: "Hospitality" },
  { name: "KettleHouse Brewing", sector: "Hospitality" },
  { name: "Town Pump", sector: "Retail" },
  { name: "Costco", sector: "Retail" },
  { name: "Murdoch's", sector: "Retail" },
  { name: "Submittable", sector: "Tech" },
  { name: "ATG", sector: "Tech" },
  { name: "onX Maps", sector: "Tech" },
  { name: "Washington Companies", sector: "Trades" },
  { name: "DJ&A Engineering", sector: "Trades" },
];

export interface EmployerSummary {
  name: string;
  sector: string;
  curated: boolean;
  openings: number;
}

export async function getEmployerSummary(): Promise<{ employers: EmployerSummary[]; fetchedAt: string }> {
  // Run a broad job pull to derive auto-detected employers
  const broad = await getJobs({ q: "", sources: ["indeed", "ziprecruiter", "montana_joblink"] });
  const counts = new Map<string, number>();
  for (const j of broad.jobs) {
    if (!j.company) continue;
    const k = j.company.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Curated first — show whether each is currently hiring
  const curatedKeys = new Set(CURATED_EMPLOYERS.map((c) => c.name.toLowerCase()));
  const out: EmployerSummary[] = CURATED_EMPLOYERS.map((c) => {
    // Match by case-insensitive contains so "St Patrick Hospital" matches "St. Patrick Hospital"
    let openings = 0;
    for (const [name, n] of counts) {
      if (name.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(name.toLowerCase())) {
        openings += n;
      }
    }
    return { name: c.name, sector: c.sector, curated: true, openings };
  });

  // Auto-detected — add top 12 non-curated employers with ≥ 2 openings
  const extras = Array.from(counts.entries())
    .filter(([name, n]) => n >= 2 && !curatedKeys.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, openings]) => ({ name, sector: "Other", curated: false, openings }));

  return { employers: [...out, ...extras], fetchedAt: broad.fetchedAt };
}
