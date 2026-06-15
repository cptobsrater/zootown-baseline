/**
 * ZooTown News - daily anchor script generator (v2).
 *
 * Canonical voice + structure: server/learning/zootown-minute-reference.md
 *
 * What this returns:
 *   Markdown anchor script with:
 *     - Anchor intro
 *     - Five story segments, each with body + stage cue + kicker
 *     - Toss-to-weather outro
 *   Each meaningful claim gets an inline source attribution in
 *   `[[slug](url)]` form, attribution slug never `zootownhub`.
 *
 * Editorial rules (enforced via prompt + validator):
 *   - American English, conversational but objective. No first-person opinion.
 *   - Banned AI-isms ("a testament to", "delving into", "underscores", etc).
 *   - No em-dashes. Use commas / sentence breaks.
 *   - No invented facts. If a detail is not in the source body, omit it.
 *     Use [BRACKETED PLACEHOLDERS] only when essential information is missing.
 *   - Inline source attribution required on each claim.
 *   - Sources may never be zootownhub.com (it is the destination, not the wire).
 *     The toss-to-weather line at the end MAY mention zootownhub.com as the
 *     destination ("more tonight on zootownhub.com").
 *   - Each story is its own self-contained segment. Stays in rotation until
 *     the underlying event happens OR a material detail changes.
 *
 * Output is markdown, not JSON. JSON mode was too fragile against
 * Gemini's quote-escaping bugs.
 */

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const BANNED_PHRASES = [
  "a testament to",
  "testament to",
  "delving into",
  "as we delve",
  "delve",
  "shed light on",
  "shed new light",
  "navigate the complexities",
  "in the realm of",
  "in today's fast-paced",
  "ever-evolving",
  "ever evolving",
  "underscores",
  "underscoring",
  "underscored",
  "moreover",
  "furthermore",
  "tapestry",
  "rich tapestry",
  "game-changer",
  "game changer",
  "paradigm shift",
  "robust",
  "leverage",
  "leveraging",
  "synergy",
  "in conclusion",
  "it is important to note",
  "it's worth noting",
  "needless to say",
  "at the end of the day",
];

const WORD_MIN = 280;
const WORD_MAX = 360;
const WPM_TARGET = 150;

export interface ScriptStoryInput {
  id: number;
  /** Stable key for segment-persistence. e.g. "zootown-festival-2026". */
  segment_key?: string;
  /** Category for tone selection: festival | safety | civic | recreation | community | sports. */
  category?: string;
  headline: string;
  summary: string;
  source_name: string;
  source_url: string;
  /** Short source slug used in [[slug](url)] attributions. e.g. "missoulian", "kpax". */
  source_slug?: string;
  published_at: string;
  /** Optional fetched + cleaned article body. */
  article_body?: string;
}

export interface ScriptResult {
  script: string;
  word_count: number;
  estimated_seconds: number;
  attempts: number;
  warnings: string[];
  anchor_name: string;
  /** Raw character length of last Gemini response, for debugging truncation. */
  raw_chars: number;
  /** Gemini finishReason on the last call: STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER. */
  finish_reason?: string;
}

const ANCHOR_NAME = "Nicholas";

function countWords(s: string): number {
  // Count words excluding inline markdown attributions [[...](...)] and stage cues
  // wrapped in *(...)* so we measure spoken-word duration accurately.
  const spoken = s
    .replace(/\[\[[^\]]+\]\([^)]+\)\]/g, "") // strip [[slug](url)]
    .replace(/\*\([^)]+\)\*/g, "") // strip *(stage cue)*
    .replace(/^#+\s.*$/gm, "") // strip headings
    .replace(/\[[A-Z][A-Z0-9 _-]+\]/g, ""); // strip [BRACKET PLACEHOLDER]
  return spoken.trim().split(/\s+/).filter(Boolean).length;
}

function findBannedPhrases(script: string): string[] {
  const hay = script.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ");
  const hits: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (hay.includes(phrase.toLowerCase())) hits.push(phrase);
  }
  return hits;
}

function findEmDashes(script: string): boolean {
  // Allow en-dashes only inside compound modifiers between letters (e.g. "below-market-rate").
  // Strict ban on em-dashes everywhere.
  if (/\u2014/.test(script)) return true;
  // Strip compound-word hyphens then look for en-dash usage as a pause-pause character.
  return /\u2013/.test(script);
}

function findZootownHubAttribution(script: string): boolean {
  // zootownhub.com is allowed ONLY in the toss-to-weather outro as a
  // destination link, not as a story source attribution. Strict check:
  // any [[zootownhub](...)] anywhere in the story segments (before the
  // toss outro) is a violation. We approximate by allowing it only when
  // it follows the phrase "on zootownhub.com" in the same sentence.
  const matches = Array.from(script.matchAll(/\[\[zootownhub\]\([^)]+\)\]/gi));
  if (matches.length === 0) return false;
  // If it appears, ensure each occurrence is preceded by "on zootownhub.com" or "channels".
  for (const m of matches) {
    const start = Math.max(0, (m.index ?? 0) - 80);
    const ctx = script.slice(start, (m.index ?? 0) + 80).toLowerCase();
    if (!ctx.includes("zootownhub.com") || !ctx.includes("on zootownhub.com")) {
      return true; // violation
    }
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
  // Fallback: extract bare domain
  try {
    const host = new URL(fallbackUrl).hostname.replace(/^www\./, "").replace(/\.com$|\.org$|\.net$/i, "");
    return host.split(".")[0] || "source";
  } catch {
    return "source";
  }
}

function buildPrompt(stories: ScriptStoryInput[], retryNote?: string): string {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  });

  // Normalize each story input.
  const enriched = stories.map((s) => ({
    ...s,
    source_slug: s.source_slug || deriveSourceSlug(s.source_name, s.source_url),
  }));

  const storyBlock = enriched
    .map((s, i) => {
      const body = s.article_body ? s.article_body.slice(0, 2500) : s.summary;
      return `STORY ${i + 1} (id ${s.id}, category=${s.category || "general"}${s.segment_key ? `, segment_key=${s.segment_key}` : ""})
HEADLINE: ${s.headline}
SOURCE NAME: ${s.source_name}
SOURCE SLUG (use in [[slug](url)] attributions): ${s.source_slug}
SOURCE URL: ${s.source_url}
PUBLISHED: ${s.published_at}
ARTICLE TEXT:
${body}
---`;
    })
    .join("\n\n");

  const bannedList = BANNED_PHRASES.map((p) => `  - "${p}"`).join("\n");

  const retry = retryNote
    ? `\n\nIMPORTANT - YOUR PREVIOUS ATTEMPT WAS REJECTED. FIX THESE ISSUES:
${retryNote}
Try again. Same stories. Same format. Fix the issue. Output the corrected script in the same markdown structure.\n`
    : "";

  return `You are writing tonight's ZooTown News evening segment. Tonight is ${dateStr}. The anchor on camera is ${ANCHOR_NAME}.

You are matching an editorial voice that has been carefully defined. Study the reference structure below and copy its rhythm, tone, attribution style, and stage-cue pattern. Then write tonight's script using the supplied stories.

REFERENCE STRUCTURE (you MUST match this exactly):

### Anchor intro
"Good evening, Missoula. I'm ${ANCHOR_NAME}, and this is ZooTown News, your look at what's happening right now across the Garden City and Western Montana."

*(Pause, small smile.)*

"From [tease segment 1], to [tease segment 2], and [tease feel-good or closing theme], we've got you covered. Let's start with tonight's top stories."

### Story 1 — [short slug describing the lead, e.g. "Zootown Festival lead"]
"[Opening sentence. Subject-verb-object. Plain language. The news of the story.]" [[source_slug](source_url)]

"[Second sentence. Why it matters. Key facts, numbers, or quotes paraphrased from the source.]" [[source_slug](source_url)]

"[Third sentence. Additional context, what comes next, or stakeholder voice.]" [[source_slug](source_url)]

*(Stage cue: tone direction for the anchor, e.g. "Beat, friendly tone." or "Calm but serious." or "Warm smile.")*

"[Kicker line: one short sentence that closes the segment with warmth, wit, or weight.]"

### Story 2 — [slug]
[same shape as Story 1]

### Story 3 — [slug]
[same shape]

### Story 4 — [slug]
[same shape]

### Story 5 — [slug]
[same shape]

### Toss to weather
"Those are your top stories. We'll have much more tonight on zootownhub.com and on our social channels." [[zootownhub](https://www.zootownhub.com/)]

"Coming up after the break: your full forecast as Missoula [contextual hook tied to tonight's stories]. [METEOROLOGIST NAME] has a first look at what you can expect."

*(Beat.)*

"You're watching ZooTown News. We'll be right back."

HARD RULES:
  1. Word count between ${WORD_MIN} and ${WORD_MAX} for the spoken text (we do NOT count the inline [[slug](url)] attributions or the *(stage cues)* or section headings toward word count - those are markup, not spoken). Target ~310 spoken words for ~125 seconds at ${WPM_TARGET} wpm.
  2. EVERY claim that comes from a source must end with [[slug](url)] inline. The slug for each story is specified in the input. Use the source's actual URL. Multiple attributions in one sentence are fine when the claim came from multiple sources.
  3. Sources may NEVER be zootownhub.com inside story segments. zootownhub.com is allowed ONLY in the toss-to-weather outro as the destination link ("more tonight on zootownhub.com").
  4. American English. Contractions OK. No first-person opinion. No second-person ("you" is OK in service-of-information sentences like "if you're planning to hit the trails"). No rhetorical questions in story bodies (kickers may use a rhetorical flourish sparingly). No editorial framing words like "shockingly", "remarkably", "in a stunning move".
  5. NO em-dashes anywhere. Replace with commas or sentence breaks. En-dashes are fine inside compound modifiers like "below-market-rate".
  6. NO invented facts. Every name, number, dollar amount, date, location, or quote must come from the supplied source article text. If essential information is missing from the source, use [BRACKETED ALL-CAPS PLACEHOLDER] like [TEEN NAME] or [METEOROLOGIST NAME]. Do not fabricate.
  7. Banned phrases (use NONE of these, in any form):
${bannedList}
  8. Each story is self-contained. They do not blur into each other. Each story has its own ### heading, its own body sentences, its own stage cue, and its own kicker line.
  9. Stage cues are always in this exact format: *(...)* on their own line. Examples: *(Pause, small smile.)*, *(Beat, friendly tone.)*, *(Shift tone: calm but serious.)*, *(Neutral, inviting tone.)*, *(Friendly, outdoorsy tone.)*, *(Warm smile.)*, *(Beat.)*
  10. Story slugs in the ### headings should be short and descriptive (3-5 words), matching the story's theme. Examples: "Zootown Festival lead", "City safety / policing", "Housing / city hall", "Environment / recreation", "Community / feel-good".

TONIGHT'S STORIES (in priority order - Story 1 is the lead):

${storyBlock}

OUTPUT:
Plain markdown. Match the reference structure exactly. No preamble before the anchor intro. No commentary after the outro. Start with "### Anchor intro" and end with "You're watching ZooTown News. We'll be right back."${retry}`;
}

interface GeminiCallResult {
  text: string;
  finishReason?: string;
  rawChars: number;
}

async function callGemini(prompt: string): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      // Generous budget: 5 segments x ~80 words each plus intro/outro plus
      // attribution markup easily fits in 4000 output tokens.
      maxOutputTokens: 4000,
    },
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
      await new Promise((r) => setTimeout(r, 2000 * (1 << i)));
      continue;
    }
    throw new Error(lastErr);
  }
  if (!res || !res.ok) throw new Error(lastErr || "Gemini unavailable");

  const data = (await res.json()) as any;
  const cand = (data?.candidates ?? [])[0] ?? {};
  const finishReason = cand?.finishReason;
  const text = cand?.content?.parts?.[0]?.text ?? "";
  // Surface truncation diagnostics so callers can decide whether to retry
  // with a bigger budget or different prompt.
  if (finishReason && finishReason !== "STOP") {
    console.warn(`[minute-script] Gemini finishReason=${finishReason} text_chars=${text.length}`);
  }
  const cleaned = text.replace(/^\s*```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return { text: cleaned, finishReason, rawChars: text.length };
}

export async function generateZootownMinuteScript(
  stories: ScriptStoryInput[],
): Promise<ScriptResult> {
  if (stories.length === 0) throw new Error("no stories supplied");
  if (stories.length > 5) stories = stories.slice(0, 5);

  const warnings: string[] = [];
  let retryNote: string | undefined;
  let lastScript = "";
  let lastCall: GeminiCallResult = { text: "", rawChars: 0 };

  // 2 attempts max: one fresh, one with validator feedback. Gemini truncation
  // tends to repeat across attempts, so deeper retries waste budget without
  // changing the outcome.
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(stories, retryNote);
    lastCall = await callGemini(prompt);
    lastScript = lastCall.text;

    const wc = countWords(lastScript);
    const banned = findBannedPhrases(lastScript);
    const hasEmDash = findEmDashes(lastScript);
    const badZTAttrib = findZootownHubAttribution(lastScript);

    // Each story should have its own ### heading and be attributed by source slug.
    const expectedHeadings = ["Anchor intro", "Toss to weather"];
    const missingHeadings = expectedHeadings.filter(
      (h) => !new RegExp(`###\\s+${h.replace(/[/]/g, "\\/")}`, "i").test(lastScript),
    );
    const storyHeadingCount = (lastScript.match(/^###\s+Story\s+\d/gim) || []).length;

    const missingAttrib = stories.filter((s) => {
      const slug = (s.source_slug || deriveSourceSlug(s.source_name, s.source_url)).toLowerCase();
      const hay = lastScript.toLowerCase();
      return !hay.includes(`[[${slug}]`);
    });

    const problems: string[] = [];
    if (wc < WORD_MIN) problems.push(`Spoken word count ${wc} is below minimum ${WORD_MIN}. Each story needs ~3 body sentences plus a kicker.`);
    if (wc > WORD_MAX) problems.push(`Spoken word count ${wc} exceeds maximum ${WORD_MAX}. Tighten sentences or shorten kickers.`);
    if (banned.length) problems.push(`Banned phrases used: ${banned.map((p) => `"${p}"`).join(", ")}. Remove them.`);
    if (hasEmDash) problems.push(`Em-dash or en-dash used as a pause character. Replace with comma or period. Compound modifiers like "below-market-rate" with hyphens are OK.`);
    if (badZTAttrib) problems.push(`zootownhub.com used as a story source attribution. It may ONLY appear in the toss-to-weather outro as a destination link.`);
    if (missingHeadings.length) problems.push(`Missing required headings: ${missingHeadings.join(", ")}.`);
    if (storyHeadingCount < stories.length) problems.push(`Expected ${stories.length} story headings (### Story 1 ...) but found ${storyHeadingCount}.`);
    if (missingAttrib.length) problems.push(`Stories missing inline [[slug](url)] attribution: ${missingAttrib.map((s) => `id ${s.id} (slug=${s.source_slug || deriveSourceSlug(s.source_name, s.source_url)})`).join("; ")}.`);

    if (problems.length === 0) {
      return {
        script: lastScript,
        word_count: wc,
        estimated_seconds: Math.round((wc / WPM_TARGET) * 60 * 10) / 10,
        attempts: attempt,
        warnings,
        anchor_name: ANCHOR_NAME,
        raw_chars: lastCall.rawChars,
        finish_reason: lastCall.finishReason,
      };
    }

    warnings.push(`attempt ${attempt}: ${problems.join(" | ")}`);
    if (attempt < MAX_ATTEMPTS) retryNote = problems.join("\n");
  }

  // Out of attempts - return the last try with full warnings.
  const wc = countWords(lastScript);
  return {
    script: lastScript,
    word_count: wc,
    estimated_seconds: Math.round((wc / WPM_TARGET) * 60 * 10) / 10,
    attempts: MAX_ATTEMPTS,
    warnings,
    anchor_name: ANCHOR_NAME,
    raw_chars: lastCall.rawChars,
    finish_reason: lastCall.finishReason,
  };
}
