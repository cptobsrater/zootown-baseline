/**
 * Obituary classifier (Phase 15).
 *
 * Most Montana newspapers publish obituaries to the same RSS feeds we're
 * already pulling. The simplest way to surface them onto the People desk
 * is to recognize them as we ingest, not to build a brand-new collector.
 *
 * Detection rules (any one is sufficient):
 *   - URL or source-name path contains /obituary, /obituaries, /obits,
 *     legacy.com, tributearchive.com, frazerconsultants.com, ever-loved.com
 *   - Headline matches "Firstname [M.] Lastname, dd" + age 1-110 pattern
 *   - Headline matches "Firstname Lastname (year - year)" pattern
 *   - Body starts with classic obit framing: "Firstname Lastname, age X,
 *     of <city>, passed away..." / "died" / "of natural causes"
 *
 * Obituaries are dignified, verbatim-only content; no AI paraphrase, no
 * celebratory framing applied automatically.
 */

const OBIT_HOSTS = [
  "legacy.com",
  "tributearchive.com",
  "frazerconsultants.com",
  "ever-loved.com",
  "everhere.com",
  "tributes.com",
  "dignitymemorial.com",
  "obittree.com",
  "funeralinnovations.com",
];

const OBIT_PATH_TOKENS = [
  "/obituary",
  "/obituaries",
  "/obits",
  "/obit/",
  "/death-notices",
  "/remembering",
];

// "Jane Doe, 87" or "Jane M. Doe, 87" -- the canonical newspaper obit
// headline shape.
const NAME_AGE_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+)?,\s+\d{1,3}\s*(?:$|[.\-,])/;

// "Jane Doe (1942 - 2026)" or "Robert J. Smith (1938-2026)". The middle
// initial token must allow a trailing period.
const NAME_YEAR_RANGE_RE = /^[A-Z][a-z]+(?:\s+(?:[A-Z][a-z']+|[A-Z]\.))(?:\s+(?:[A-Z][a-z']+|[A-Z]\.))*\s*\(\d{4}\s*[-\u2013]\s*\d{4}\)/;

// Body phrases that indicate an obituary.
const BODY_PHRASES = [
  /\b(?:passed away|died (?:peacefully|unexpectedly|at home|surrounded)|went to be with|entered eternal rest|departed this life)\b/i,
  /\bof natural causes\b/i,
  /\bsurvived by\b/i,
  /\bpreceded in death by\b/i,
  /\b(?:funeral|memorial|celebration of life|graveside) (?:service|will be held|services?)\b/i,
  /\bin lieu of flowers\b/i,
  /\bborn (?:on|in)\b.*\b(?:1[89]|20)\d{2}\b/i,
  /\bage \d{1,3} of (?:[A-Z][a-z]+)/,
];

export interface ObituaryClassification {
  isObituary: boolean;
  reason?: string;
}

export function classifyObituary(input: {
  headline: string;
  summary?: string | null;
  body?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
}): ObituaryClassification {
  const headline = (input.headline ?? "").trim();
  const summary = (input.summary ?? "").trim();
  const body = (input.body ?? "").trim();
  const url = (input.sourceUrl ?? "").toLowerCase();
  const sourceName = (input.sourceName ?? "").toLowerCase();

  // URL / host signals.
  for (const host of OBIT_HOSTS) {
    if (url.includes(host)) return { isObituary: true, reason: `host:${host}` };
  }
  for (const token of OBIT_PATH_TOKENS) {
    if (url.includes(token)) return { isObituary: true, reason: `path:${token}` };
  }
  // Many newspaper feeds tag obit sections in the source name.
  if (/\bobit/i.test(sourceName)) return { isObituary: true, reason: "source_name" };

  // Headline-pattern signals.
  if (NAME_AGE_RE.test(headline)) return { isObituary: true, reason: "name_age_headline" };
  if (NAME_YEAR_RANGE_RE.test(headline)) return { isObituary: true, reason: "name_year_headline" };

  // Body-phrase signals (use both summary and body since RSS feeds sometimes
  // put the whole obit in the description and leave body empty).
  const haystack = `${summary} ${body}`;
  for (const re of BODY_PHRASES) {
    if (re.test(haystack)) return { isObituary: true, reason: "body_phrase" };
  }

  return { isObituary: false };
}
