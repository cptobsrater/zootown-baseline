/**
 * ZooTown News - daily anchor script generator (v3, chunked).
 *
 * Canonical reference: server/learning/zootown-minute-reference.md
 *
 * Why chunked: Gemini's flash model truncates whole-script output around
 * 650 chars no matter what maxOutputTokens we set. We split the script into
 * 7 small Gemini calls (intro, 5 story segments, outro), each well under
 * the truncation ceiling, then concatenate. This eliminates the truncation
 * failure mode entirely.
 *
 * Editorial rules enforced via prompt + post-assembly validator:
 *   - American English. Conversational but objective. No first-person opinion.
 *   - Banned AI-isms (a testament to, delving into, underscores, etc).
 *   - No em-dashes. Use commas / sentence breaks.
 *   - No invented facts. [BRACKETED PLACEHOLDERS] for missing essentials.
 *   - Inline [[source_slug](url)] attribution required on each claim.
 *   - zootownhub.com forbidden as story-segment source; allowed ONLY in
 *     the toss-to-weather outro as destination link.
 *   - Each story is its own self-contained ### segment with body + cue + kicker.
 */

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const ANCHOR_NAME = "Nicholas";

const BANNED_PHRASES = [
  "a testament to", "testament to",
  "delving into", "as we delve", "delve",
  "shed light on", "shed new light",
  "navigate the complexities",
  "in the realm of", "in today's fast-paced",
  "ever-evolving", "ever evolving",
  "underscores", "underscoring", "underscored",
  "moreover", "furthermore",
  "tapestry", "rich tapestry",
  "game-changer", "game changer",
  "paradigm shift",
  "robust", "leverage", "leveraging", "synergy",
  "in conclusion", "it is important to note", "it's worth noting",
  "needless to say", "at the end of the day",
];

const WORD_MIN = 280;
const WORD_MAX = 360;
const WPM_TARGET = 150;

export interface ScriptStoryInput {
  id: number;
  segment_key?: string;
  category?: string;
  headline: string;
  summary: string;
  source_name: string;
  source_url: string;
  source_slug?: string;
  published_at: string;
  article_body?: string;
}

export interface ScriptResult {
  script: string;
  word_count: number;
  estimated_seconds: number;
  attempts: number;
  warnings: string[];
  anchor_name: string;
  raw_chars: number;
  finish_reason?: string;
}

function countWords(s: string): number {
  const spoken = s
    .replace(/\[\[[^\]]+\]\([^)]+\)\]/g, "")
    .replace(/\*\([^)]+\)\*/g, "")
    .replace(/^#+\s.*$/gm, "")
    .replace(/\[[A-Z][A-Z0-9 _-]+\]/g, "");
  return spoken.trim().split(/\s+/).filter(Boolean).length;
}

function findBannedPhrases(script: string): string[] {
  const hay = script.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ");
  const hits: string[] = [];
  for (const p of BANNED_PHRASES) {
    if (hay.includes(p.toLowerCase())) hits.push(p);
  }
  return hits;
}

function findEmDashes(script: string): boolean {
  // Strict ban on the em-dash character (\u2014). En-dashes (\u2013) inside
  // compound modifiers like "below-market-rate" are allowed via hyphens;
  // we ban true en-dash characters used as pause punctuation.
  if (/\u2014/.test(script)) return true;
  return /\u2013/.test(script);
}

function findZootownHubAttribution(script: string): boolean {
  // zootownhub.com is allowed ONLY in the toss-to-weather outro section.
  const matches = Array.from(script.matchAll(/\[\[zootownhub\]\([^)]+\)\]/gi));
  if (matches.length === 0) return false;
  for (const m of matches) {
    const start = Math.max(0, (m.index ?? 0) - 100);
    const ctx = script.slice(start, (m.index ?? 0) + 100).toLowerCase();
    if (!ctx.includes("on zootownhub.com")) return true;
  }
  return false;
}

function deriveSourceSlug(sourceName: string, fallbackUrl: string): string {
  const lower = sourceName.toLowerCase();
  if (lower.includes("missoulian")) return "missoulian";
  if (lower.includes("kpax")) return "kpax";
  if (lower.includes("kgvo")) return "kgvo";
  if (lower.includes("missoula current")) return "missoulacurrent";
  if (lower.includes("nbc montana")) return "nbcmontana";
  if (lower.includes("independent record")) return "independentrecord";
  if (lower.includes("billings gazette")) return "billingsgazette";
  if (lower.includes("destination missoula")) return "destinationmissoula";
  if (lower.includes("missoula downtown partnership")) return "missouladowntown";
  if (lower.includes("zootown festival")) return "zootownfestival";
  if (lower.includes("fairgrounds")) return "missoulacountyfairgrounds";
  try {
    const host = new URL(fallbackUrl).hostname.replace(/^www\./, "").replace(/\.(com|org|net)$/i, "");
    return host.split(".")[0] || "source";
  } catch {
    return "source";
  }
}

// ---------- Gemini call ----------

interface GeminiCallResult {
  text: string;
  finishReason?: string;
  rawChars: number;
}

async function callGemini(prompt: string, maxTokens = 800): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: maxTokens },
  };

  let res: Response | null = null;
  let lastErr = "";
  for (let i = 0; i < 4; i++) {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    const t = await res.text().catch(() => "");
    lastErr = `Gemini HTTP ${res.status}: ${t.slice(0, 200)}`;
    if (res.status === 503 || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (1 << i)));
      continue;
    }
    throw new Error(lastErr);
  }
  if (!res || !res.ok) throw new Error(lastErr || "Gemini unavailable");

  const data = (await res.json()) as any;
  const cand = (data?.candidates ?? [])[0] ?? {};
  const finishReason = cand?.finishReason;
  const text = cand?.content?.parts?.[0]?.text ?? "";
  if (finishReason && finishReason !== "STOP") {
    console.warn(`[minute-script] sub-call finishReason=${finishReason} chars=${text.length}`);
  }
  const cleaned = text.replace(/^\s*```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return { text: cleaned, finishReason, rawChars: text.length };
}

// ---------- Per-segment prompt builders ----------

function buildIntroPrompt(stories: ScriptStoryInput[]): string {
  const teases = stories.slice(0, 3)
    .map((s) => `(${s.category || "general"}) ${s.headline}`)
    .join(" | ");
  return `Write the cold-open intro for the ZooTown News evening broadcast. Anchor is ${ANCHOR_NAME}.

Output EXACTLY this markdown, nothing else:

### Anchor intro
"Good evening, Missoula. I'm ${ANCHOR_NAME}, and this is ZooTown News, your look at what's happening right now across the Garden City and Western Montana."

*(Pause, small smile.)*

"From <TEASE_1>, to <TEASE_2>, and <TEASE_3>, we've got you covered. Let's start with tonight's top stories."

Fill <TEASE_1>, <TEASE_2>, <TEASE_3> with 3-7 evocative words each (no punctuation, no quotes inside). Themes to pull from: ${teases}

Rules: first sentence verbatim with anchor name "${ANCHOR_NAME}". No em-dashes. No banned AI-isms. American English. Return ONLY the markdown above with teases filled in.`;
}

interface ThemeHint { headingSlug: string; cue: string }
const THEME_HINTS: Record<string, ThemeHint> = {
  safety:     { headingSlug: "City safety / policing",   cue: "Shift tone: calm but serious." },
  civic:      { headingSlug: "City hall decision",       cue: "Neutral, inviting tone." },
  sports:     { headingSlug: "Sports update",            cue: "Energetic but measured." },
  recreation: { headingSlug: "Environment / recreation", cue: "Friendly, outdoorsy tone." },
  community:  { headingSlug: "Community spotlight",      cue: "Warm smile." },
  festival:   { headingSlug: "Festival preview",         cue: "Beat, friendly tone." },
  general:    { headingSlug: "Local news",               cue: "Steady, professional." },
};

function buildStoryPrompt(story: ScriptStoryInput, index: number): string {
  const slug = story.source_slug || deriveSourceSlug(story.source_name, story.source_url);
  const body = story.article_body && story.article_body.length > 100
    ? story.article_body.slice(0, 2500)
    : story.summary;
  const hint = THEME_HINTS[story.category || "general"] || THEME_HINTS.general;

  return `Write Story ${index + 1} of tonight's ZooTown News broadcast. One self-contained anchor segment.

FORMAT (return EXACTLY this markdown, nothing else):

### Story ${index + 1} - <SHORT_SLUG>
"<SENTENCE_1>" [[${slug}](${story.source_url})]

"<SENTENCE_2>" [[${slug}](${story.source_url})]

"<SENTENCE_3>" [[${slug}](${story.source_url})]

*(${hint.cue})*

"<KICKER>"

RULES:
  - <SHORT_SLUG>: 3-5 descriptive words like "${hint.headingSlug}".
  - SENTENCE_1: the news. Subject-verb-object. Plain language.
  - SENTENCE_2: why it matters or key fact paraphrased from source.
  - SENTENCE_3: context, stakeholder voice, or what comes next.
  - KICKER: one short closing sentence with warmth, wit, or weight.
  - Each of the 3 body sentences ends with [[${slug}](${story.source_url})] inline.
  - Total spoken words (3 body + kicker, NOT counting [[]] markup or stage cue): 55-80 words.
  - No em-dashes. No invented facts (use [BRACKET_ALLCAPS] if essential info missing).
  - Banned phrases: a testament to, delving into, shed light on, navigate the complexities, ever-evolving, underscores, moreover, furthermore, tapestry, robust, leverage, synergy, in conclusion, it's worth noting, needless to say, at the end of the day, game-changer, paradigm shift.
  - Conversational but objective. No first-person. No rhetorical questions in body sentences.
  - American English. Contractions OK.

HEADLINE: ${story.headline}
SOURCE: ${story.source_name}

ARTICLE TEXT:
${body}

Return ONLY the markdown segment. No preamble. No commentary.`;
}

function buildOutroPrompt(stories: ScriptStoryInput[]): string {
  const weatherStory = stories.find((s) =>
    /trail|river|weather|fire|outdoor|fairground|park|festival|weekend|outside|forest|highway/i
      .test(s.headline + " " + (s.summary || "")),
  );
  const hookHint = weatherStory
    ? `tonight's stories touch on "${weatherStory.headline}" - the weather hook can riff on that`
    : `the weather hook is open - tie it to general Missoula evening conditions`;

  return `Write the toss-to-weather outro for the ZooTown News evening broadcast.

Output EXACTLY this markdown, nothing else:

### Toss to weather
"Those are your top stories. We'll have much more tonight on zootownhub.com and on our social channels." [[zootownhub](https://www.zootownhub.com/)]

"Coming up after the break: your full forecast as Missoula <HOOK>. [METEOROLOGIST NAME] has a first look at what you can expect."

*(Beat.)*

"You're watching ZooTown News. We'll be right back."

Replace <HOOK> with a short clause (5-12 words) connecting the weather to tonight's news. ${hookHint}.

Rules:
  - First sentence stays verbatim including "zootownhub.com".
  - [[zootownhub](https://www.zootownhub.com/)] attribution stays exactly as shown.
  - [METEOROLOGIST NAME] in brackets stays as a placeholder.
  - No em-dashes. No banned AI-isms.
  - Return ONLY the markdown above.`;
}

// ---------- Main entry ----------

export async function generateZootownMinuteScript(
  stories: ScriptStoryInput[],
): Promise<ScriptResult> {
  if (stories.length === 0) throw new Error("no stories supplied");
  if (stories.length > 5) stories = stories.slice(0, 5);

  const enriched = stories.map((s) => ({
    ...s,
    source_slug: s.source_slug || deriveSourceSlug(s.source_name, s.source_url),
  }));

  // Generate all 7 sub-segments sequentially with a tiny pacing delay.
  // Gemini's free tier has tight per-minute quotas; firing 7 calls in
  // parallel trips the 429 rate limit. Sequential keeps us under the
  // ceiling at the cost of ~30s total latency.
  const PACING_MS = 600;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const introCall = await callGemini(buildIntroPrompt(enriched), 400);
  await sleep(PACING_MS);

  const segmentCalls: GeminiCallResult[] = [];
  for (let i = 0; i < enriched.length; i++) {
    segmentCalls.push(await callGemini(buildStoryPrompt(enriched[i], i), 600));
    await sleep(PACING_MS);
  }

  const outroCall = await callGemini(buildOutroPrompt(enriched), 400);

  const script = [
    introCall.text.trim(),
    ...segmentCalls.map((c) => c.text.trim()),
    outroCall.text.trim(),
  ].join("\n\n");

  const totalRaw =
    introCall.rawChars +
    segmentCalls.reduce((a, c) => a + c.rawChars, 0) +
    outroCall.rawChars;
  const truncated = [introCall, ...segmentCalls, outroCall]
    .filter((c) => c.finishReason === "MAX_TOKENS");

  const warnings: string[] = [];
  if (truncated.length) {
    warnings.push(`${truncated.length} of ${segmentCalls.length + 2} sub-calls hit MAX_TOKENS; consider raising sub-call budget`);
  }

  const wc = countWords(script);
  const banned = findBannedPhrases(script);
  const hasEmDash = findEmDashes(script);
  const badZTAttrib = findZootownHubAttribution(script);
  if (banned.length) warnings.push(`banned phrases: ${banned.join(", ")}`);
  if (hasEmDash) warnings.push(`em/en-dash present`);
  if (badZTAttrib) warnings.push(`zootownhub.com used as story source (only allowed in outro)`);
  if (wc < WORD_MIN) warnings.push(`spoken word count ${wc} below min ${WORD_MIN}`);
  if (wc > WORD_MAX) warnings.push(`spoken word count ${wc} above max ${WORD_MAX}`);

  return {
    script,
    word_count: wc,
    estimated_seconds: Math.round((wc / WPM_TARGET) * 60 * 10) / 10,
    attempts: 1,
    warnings,
    anchor_name: ANCHOR_NAME,
    raw_chars: totalRaw,
    finish_reason: truncated.length ? "MAX_TOKENS" : "STOP",
  };
}
