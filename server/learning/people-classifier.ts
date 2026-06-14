/**
 * People-profile classifier (Phase 15).
 *
 * Detects "positive profile of a Montana person" stories -- the
 * celebration content type that drives the People desk. Examples:
 *   - "Bozeman senior signs with Cal" (athlete)
 *   - "Missoula attorney wins national pro bono award" (lawyer)
 *   - "CMR student takes 1st at national chess championship"
 *   - "Local pediatrician earns lifetime achievement honor"
 *   - "Helena actress lands lead in upcoming film"
 *
 * Cross-cutting cases (national-stage MT athletes) light up BOTH the
 * People classifier AND the Sports classifier; the orchestrator
 * cross-posts to both desks.
 *
 * Negative-event guard: stories with negative framing words are explicitly
 * REJECTED from the People desk even if they contain achievement-shaped
 * verbs. People is a celebration desk; arrests, sentences, scandals, etc.
 * route to Crime/Business/etc. as usual.
 *
 * Output:
 *   isPeopleProfile -- yes/no
 *   scope -- national | regional | state | community (drives ranking)
 *   subject -- best-effort name extraction (for display + future matching)
 *   alsoSports -- true when subject is an athlete with national stage
 */
export type PeopleScope = "national" | "regional" | "state" | "community";

export interface PeopleClassification {
  isPeopleProfile: boolean;
  scope: PeopleScope | null;
  /** Best-effort extracted subject name (e.g. "Marcus Yang"). May be null. */
  subject: string | null;
  /** True when this is ALSO a sports story (national-stage MT athlete). */
  alsoSports: boolean;
  reason?: string;
}

// Words/phrases that scream POSITIVE achievement.
const POSITIVE_VERBS = [
  "wins", "won", "earned", "earns",
  "honored", "honors", "recognized", "recognition",
  "awarded", "receives", "received",
  "named", "appointed", "selected",
  "signs with", "signed with",
  "commits to", "committed to",
  "drafted by", "drafted",
  "promoted to",
  "graduates", "graduated",
  "champions", "championship",
  "finishes first", "first place",
  "takes 1st", "takes first", "took 1st", "took first",
  "takes home", "takes the title",
  "achieves", "achieved",
  "celebrates",
  "lands role", "lands part",
  "publishes",
  "elected",
  "qualifies for", "qualified for",
  "advances to", "advanced to",
  "places", "placed",
  "breaks record", "breaks the record",
];

// Phrases that ONLY appear in personal-profile / spotlight context.
const PROFILE_HINTS = [
  /\b(local|hometown)\s+(?:hero|standout|talent|kid|student|athlete|artist|musician|teacher|lawyer|attorney|doctor|nurse|firefighter|veteran|farmer|rancher|coach|chef|engineer|scientist|author|writer|filmmaker|actor|actress)\b/i,
  /\bspotlight on\b/i,
  /\bprofile of\b/i,
  // "Bozeman senior wins/takes/earns/signs/commits..." -- the canonical
  // student-profile shape. Broadened to cover any city + any positive verb.
  /\b(?:senior|junior|sophomore|freshman|grad|alum|alumna|alumnus|student)\s+(?:earns|wins|signs|commits|named|honored|takes|took|places|placed|finishes|finished|qualifies|qualified|advances|advanced|achieves|achieved|receives|received|graduates|graduated|breaks|broke|sets|set)\b/i,
  // Anyone "takes 1st" / "wins gold" / "national champ" / etc. with a
  // Montana place name nearby strongly implies a person-profile.
  /\b(?:takes|took|wins|won|claims|claimed)\s+(?:1st|first|gold|silver|bronze|the (?:title|crown|championship))/i,
  /\bvalediction|valedictorian\b/i,
  /\bteacher of the year\b/i,
  /\b(?:student|athlete|coach|employee) of the (?:year|month|week)\b/i,
  /\beagle scout\b/i,
  /\blifetime achievement\b/i,
  /\bnational (?:champ(?:s|ion)?|finalist|qualifier|tournament)\b/i,
  /\bfamily man|family woman|loving (?:husband|wife|father|mother|grandfather|grandmother)\b/i,
];

// Negative framing -- presence of any of these REJECTS the story from People.
const NEGATIVE_GUARDS = [
  /\barrested\b/i,
  /\bcharged with\b/i,
  /\bindicted\b/i,
  /\bconvicted\b/i,
  /\bsentenced\b/i,
  /\bplea[d]?ed? (?:guilty|not guilty)\b/i,
  /\bsued for\b/i,
  /\blawsuit\b/i,
  /\bdisbarred\b/i,
  /\bfired (?:after|for|over)\b/i,
  /\bresigns? (?:amid|after) (?:scandal|allegations|controversy)\b/i,
  /\bscandal\b/i,
  /\ballegations? of\b/i,
  /\bsex(?:ual)? (?:assault|misconduct|abuse|harassment)\b/i,
  /\bdomestic (?:violence|assault)\b/i,
  /\bDUI\b/,
  /\bfraud\b/i,
  /\bembezzle/i,
  /\b(?:theft|stolen|robber)/i,
  /\bcrash (?:kills|killed|injures|injured)/i, // accident headlines are crime/news, not People
];

// Scope keywords.
const NATIONAL_HINTS = [
  // "national champion", "national high school chess championship",
  // "national amateur title". We allow up to ~3 words of context between
  // "national" and the achievement noun.
  /\bnational(?:ly)?(?:\s+\w+){0,3}\s+(?:champion|title|award|recognition|honor|tournament|championship|finalist|qualifier|meet|event|competition)/i,
  /\bnationally (?:ranked|recognized)/i,
  /\bU\.?S\.? Open\b/i,
  /\bOlympic|Olympian\b/i,
  /\bNCAA\b/i,
  /\bNFL|NBA|MLB|NHL|MLS|WNBA\b/,
  /\bgrammy|emmy|oscar|tony|pulitzer\b/i,
  /\bBroadway\b/i,
  /\b(?:white house|congress(?:ional)?|federal court|supreme court)\b/i,
  /\bAll-?American\b/i,
  /\bsigns? with (?:the )?[A-Z]/, // signs with a named pro org
  /\bcommits? to (?:the )?[A-Z]/i, // "commits to Cal" / "commits to the Bears"
  /\bdrafted by\b/i,
];
const REGIONAL_HINTS = [
  /\b(big sky|pioneer league|frontier conference)\b/i,
  /\b(west region(?:al)?|northwest region(?:al)?)\b/i,
];
const STATE_HINTS = [
  /\bstate (?:champion|title|champ(?:s|ionship)?|tournament|finals?|qualifier)\b/i,
  /\bMontana (?:high school|championship|champion|state|teacher of the year)\b/i,
  /\bMHSA\b/,
  /\bAll-State\b/,
];
// Default scope when no hint matches.
const DEFAULT_SCOPE: PeopleScope = "community";

// Sports keyword set for cross-posting detection (high recall vs. precision).
const SPORTS_DOMAIN_WORDS = [
  /\bathlete\b/i, /\bplayer\b/i, /\bcoach\b/i,
  /\bfootball|basketball|baseball|softball|volleyball|soccer|hockey|wrestling|track\b/i,
  /\bgolf|tennis|swim|swimmer|skiing|skier|snowboard\b/i,
  /\bcommits to\b/i, /\bsigns with\b/i, /\bdrafted by\b/i,
];

function isNegative(text: string): boolean {
  return NEGATIVE_GUARDS.some((re) => re.test(text));
}

function detectScope(text: string): PeopleScope {
  if (NATIONAL_HINTS.some((re) => re.test(text))) return "national";
  if (REGIONAL_HINTS.some((re) => re.test(text))) return "regional";
  if (STATE_HINTS.some((re) => re.test(text))) return "state";
  return DEFAULT_SCOPE;
}

/**
 * Best-effort subject-name extraction. Looks for sequences of 2-3
 * capitalized words near the start of the headline. Pretty crude but
 * works often enough for display. Returns null when no obvious name.
 */
function extractSubject(headline: string): string | null {
  if (!headline) return null;
  // Skip leading article/preposition tokens.
  const trimmed = headline.replace(/^(?:the|a|an|in|of|at|for|with|by)\s+/i, "");
  // "Firstname Lastname" or "Firstname M. Lastname".
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/;
  const m = trimmed.match(re);
  if (!m) return null;
  // Reject common false positives.
  const candidate = m[1];
  const blacklist = ["High School", "United States", "Great Falls", "Big Sky", "Class A",
    "Class B", "Class AA", "Mountain West", "Pacific Northwest", "First Lady",
    "Last Best", "Montana Teacher", "Teacher of", "State of", "Years Old",
    "New York", "Los Angeles", "San Francisco", "Salt Lake"];
  if (blacklist.some((b) => candidate.includes(b))) return null;
  return candidate;
}

export function classifyPeople(input: {
  headline: string;
  summary?: string | null;
  body?: string | null;
}): PeopleClassification {
  const empty: PeopleClassification = {
    isPeopleProfile: false,
    scope: null,
    subject: null,
    alsoSports: false,
  };
  const headline = input.headline ?? "";
  const summary = input.summary ?? "";
  const text = `${headline}. ${summary}`;
  if (!text.trim()) return empty;

  // Hard reject on any negative-framing word.
  if (isNegative(text)) return { ...empty, reason: "negative_guard" };

  const lc = text.toLowerCase();

  // Must have either (a) a profile hint phrase, or (b) a positive verb +
  // an extractable subject name.
  const hasProfileHint = PROFILE_HINTS.some((re) => re.test(text));
  const hasPositiveVerb = POSITIVE_VERBS.some((v) => lc.includes(v));

  if (!hasProfileHint && !hasPositiveVerb) return empty;

  // Subject extraction. Profile hints can fire without a name (e.g. "Local
  // hometown hero..."), but the most common positive case has a name.
  const subject = extractSubject(headline) ?? extractSubject(summary.slice(0, 200));

  // Require either: a name + a positive verb, OR a profile hint (which
  // implies the person is the subject even without explicit name capture).
  if (!subject && !hasProfileHint) return empty;

  const scope = detectScope(text);
  const alsoSports = SPORTS_DOMAIN_WORDS.some((re) => re.test(text));

  return {
    isPeopleProfile: true,
    scope,
    subject,
    alsoSports,
  };
}
