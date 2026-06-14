/**
 * Event desk classifier.
 *
 * Reads (headline, summary, venue, sourceName) and decides which desk an
 * event belongs to. Layered approach:
 *
 *   Layer 1 -- KEYWORD RULES (fast, free, auditable)
 *     If the title/venue clearly matches a category, return immediately.
 *     Most events resolve here.
 *
 *   Layer 2 -- GEMINI FALLBACK (only if rules are ambiguous)
 *     Sends just the event metadata (no full body) to Gemini Flash with
 *     a desk-only system prompt. Cheap (< 200 tokens per call), bounded.
 *
 * The user explicitly removed 'people' and 'history' as valid desks for
 * the calendar (nothing real is ever those). The allowed set is:
 *   city, business, crime, sports, health, entertainment
 *
 * Default when uncertain: entertainment (the historical bias, matches
 * existing behavior).
 */

export const EVENT_DESKS = [
  "city",
  "business",
  "crime",
  "sports",
  "health",
  "entertainment",
] as const;
export type EventDesk = (typeof EVENT_DESKS)[number];

interface EventInput {
  headline: string;
  summary: string;
  venue?: string | null;
  sourceName?: string | null;
}

interface ClassifyResult {
  desk: EventDesk;
  confidence: "rule" | "gemini" | "default";
  rule?: string;          // which rule fired, for audit
}

// ----- Layer 1: keyword rules -----
//
// Each rule = { desk, patterns, where }. A pattern is a lowercased substring
// or a regex. `where` says which fields to check. We return on first match
// in the priority order below (crime > health > business > sports > city >
// entertainment) because the more specific desk wins ties.

interface Rule {
  desk: EventDesk;
  description: string;
  match: (ctx: { all: string; headline: string; venue: string; source: string }) => boolean;
}

const RULES: Rule[] = [
  // ---- CRIME ----
  {
    desk: "crime",
    description: "police-sponsored event",
    match: (c) =>
      /\b(police department|sheriff|highway patrol|police academy|citizens academy|neighborhood watch|crime prevention|k-?9 demo|drug take-?back|dare program)\b/i.test(c.all) ||
      /\bpolice\b/i.test(c.venue) ||
      /\bsheriff\b/i.test(c.venue),
  },
  // ---- HEALTH ----
  {
    desk: "health",
    description: "health screening / blood drive / mental health",
    match: (c) =>
      /\b(blood drive|blood donation|red cross|vaccin(e|ation) clinic|flu shot|covid test|health screening|wellness fair|nutrition class|cancer screening|aa meeting|na meeting|grief support|mental health|suicide prevention|recovery group|narcan training|cpr (class|training)|first aid (class|training))\b/i.test(c.all),
  },
  // ---- BUSINESS ----
  {
    desk: "business",
    description: "career / certification / hiring",
    match: (c) =>
      /\b(career fair|hiring fair|job fair|networking|chamber of commerce|small business|entrepreneur|startup|grand opening|ribbon cutting|business mixer|certification (class|course)|continuing education|cpa exam|real estate (class|license)|coding bootcamp|workshop on (marketing|sales|finance|accounting))\b/i.test(c.all),
  },
  // ---- SPORTS ----
  {
    desk: "sports",
    description: "athletic event / game / race",
    match: (c) =>
      /\b(basketball game|football game|volleyball|soccer match|hockey|wrestling meet|track meet|cross country|swim meet|tennis match|golf tournament|5k|10k|marathon|half marathon|fun run|race day|tip-?off|playoffs|championship|jamboree|tournament|home (game|meet))\b/i.test(c.all) ||
      /\b(stadium|fieldhouse|arena|gymnasium|ballpark)\b/i.test(c.venue) ||
      // High-school athletics signature
      /\b(MHSA|montana high school association|griz|bobcats|argonauts|saints athletics)\b/i.test(c.all),
  },
  // ---- CITY ----
  {
    desk: "city",
    description: "civic / government / city services",
    match: (c) =>
      /\b(city council|county commission|public hearing|planning commission|zoning meeting|town hall|mayor|board of (education|county commissioners)|civic center|public works|town meeting|community meeting|public input|public comment|farmers market|parade|fourth of july|memorial day|veterans day|fire department|wildfire briefing|emergency preparedness)\b/i.test(c.all) ||
      // School board, library systems
      /\b(school board|library board|library event|library reading|story time)\b/i.test(c.all),
  },
  // ---- ENTERTAINMENT (true cases, not just the default) ----
  {
    desk: "entertainment",
    description: "music / theater / arts venue",
    match: (c) =>
      /\b(concert|live music|open mic|comedy|stand-?up|theater performance|theatre performance|gallery opening|art opening|art walk|exhibition opening|brewery event|distillery event|wine tasting|beer release|trivia night|karaoke|dance party|film screening|movie night|festival)\b/i.test(c.all) ||
      /\b(kettlehouse|wilma|top hat|logjam|elm|the elm|brewery|distillery|theatre|playhouse|amphitheater|amphitheatre)\b/i.test(c.venue) ||
      /\b(eventbrite|songkick|bandsintown)\b/i.test(c.source),
  },
];

function applyRules(input: EventInput): ClassifyResult | null {
  const headline = (input.headline ?? "").toLowerCase();
  const summary = (input.summary ?? "").toLowerCase();
  const venue = (input.venue ?? "").toLowerCase();
  const source = (input.sourceName ?? "").toLowerCase();
  const all = `${headline} ${summary} ${venue} ${source}`;

  const ctx = { all, headline, venue, source };
  for (const r of RULES) {
    if (r.match(ctx)) {
      return { desk: r.desk, confidence: "rule", rule: r.description };
    }
  }
  return null;
}

// ----- Layer 2: Gemini fallback -----
//
// Only called when rules don't fire. The system prompt is intentionally
// minimal -- one decision, six options, return JSON.

const GEMINI_DESK_PROMPT = `You are a calendar classifier for a Montana local news aggregator.

Given an event's title, summary, and venue, choose the single best DESK from this exact list:

  - city          (civic, government, public meetings, parades, farmers markets, libraries)
  - business      (career fairs, certifications, chamber, hiring, grand openings, business workshops)
  - crime         (police-hosted events, neighborhood watch, K-9 demos, drug takebacks)
  - sports        (games, tournaments, races, athletic meets at any level)
  - health        (blood drives, vaccine clinics, mental health, fitness expos, recovery groups)
  - entertainment (concerts, theater, art openings, festivals, brewery events, comedy)

Return STRICT JSON only: { "desk": "<one of the six>" }
No other text. No explanation.`;

interface GeminiClassifyResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

async function classifyWithGemini(input: EventInput): Promise<EventDesk | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const userText = `Title: ${input.headline}\nSummary: ${input.summary}\nVenue: ${input.venue ?? ""}\nSource: ${input.sourceName ?? ""}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: GEMINI_DESK_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 32,
      responseMimeType: "application/json",
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiClassifyResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    let parsed: { desk?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (parsed.desk && (EVENT_DESKS as readonly string[]).includes(parsed.desk)) {
      return parsed.desk as EventDesk;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The main entry point. Caller passes the event metadata; we return the
 * desk + provenance.
 *
 * Performance note: rule layer is ~microseconds. Gemini layer is ~600ms
 * average. Use the `skipGemini` flag in batch backfills to keep the run
 * under cron deadlines; pure-rule classification is good enough for ~80%
 * of events in our corpus.
 */
export async function classifyEvent(
  input: EventInput,
  opts: { skipGemini?: boolean } = {},
): Promise<ClassifyResult> {
  const ruleHit = applyRules(input);
  if (ruleHit) return ruleHit;

  if (!opts.skipGemini) {
    const desk = await classifyWithGemini(input);
    if (desk) return { desk, confidence: "gemini" };
  }

  // Final fallback. Matches historical behavior; admin can override.
  return { desk: "entertainment", confidence: "default" };
}
