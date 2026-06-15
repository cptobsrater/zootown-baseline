/**
 * ZooTown Minute - script generator.
 *
 * Input:  5 ranked stories (headline, summary, source_name, source_url, published_at).
 *         Optional `articleBodies` keyed by story id with cleaned source text.
 * Output: a 90-second anchor script (target 215-230 words, 150 wpm cadence)
 *         plus per-story attribution metadata for the disclosure card.
 *
 * Editorial law (enforced in the prompt and re-checked after):
 *   1. STRICT word count: 215 <= words <= 230. The post-call validator
 *      rejects and re-asks if Gemini drifts.
 *   2. Every story must be attributed to its source by name. "Missoulian
 *      reports" / "Per the Missoula Current" / "According to the
 *      Independent Record".
 *   3. Conversational but OBJECTIVE. News anchor, not influencer. No
 *      first-person opinions, no rhetorical questions, no breathless
 *      hype, no editorial framing ("shockingly", "incredibly").
 *   4. Banned AI-isms: "a testament to", "delving into", "in today's
 *      fast-paced world", "navigate the complexities", "shed light on",
 *      "in the realm of", "as we delve", "underscores", "underscoring",
 *      "moreover", "furthermore", "tapestry", "landscape" (as cliche),
 *      "ever-evolving", "game-changer", "robust" (as filler).
 *   5. No invented facts. If a detail isn't in the provided source text,
 *      it must not appear in the script. Numbers, names, dates, locations
 *      get repeated verbatim from the source.
 *   6. Plain American English. Contractions are fine. No em-dashes (HeyGen
 *      mis-renders them as awkward pauses); use commas or sentence breaks.
 */
import type { Story } from "@shared/schema";

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

const WORD_MIN = 215;
const WORD_MAX = 230;
const WPM_TARGET = 150;

export interface ScriptStoryInput {
  id: number;
  headline: string;
  summary: string;
  source_name: string;
  source_url: string;
  published_at: string;
  /** Optional fetched + cleaned article body. Higher quality scripts when provided. */
  article_body?: string;
}

export interface ScriptResult {
  script: string;
  word_count: number;
  estimated_seconds: number;
  attributions: Array<{ story_id: number; source_name: string; source_url: string }>;
  attempts: number;
  warnings: string[];
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function stripPunctForCheck(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ");
}

function findBannedPhrases(script: string): string[] {
  const hay = stripPunctForCheck(script);
  const hits: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (hay.includes(phrase.toLowerCase())) hits.push(phrase);
  }
  return hits;
}

function buildPrompt(stories: ScriptStoryInput[], retryNote?: string): string {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  });

  const storyBlock = stories
    .map((s, i) => {
      const body = s.article_body ? s.article_body.slice(0, 2500) : s.summary;
      return `STORY ${i + 1} (id ${s.id})
HEADLINE: ${s.headline}
SOURCE: ${s.source_name}
URL: ${s.source_url}
PUBLISHED: ${s.published_at}
ARTICLE TEXT:
${body}
---`;
    })
    .join("\n\n");

  const bannedList = BANNED_PHRASES.map((p) => `  - "${p}"`).join("\n");

  const retry = retryNote
    ? `\n\nIMPORTANT - YOUR PREVIOUS ATTEMPT WAS REJECTED:
${retryNote}
Try again. Same five stories. Fix the issue. Same JSON output shape.\n`
    : "";

  return `You are writing tonight's ZooTown Minute - a 90-second evening news segment for Missoula, Montana, broadcast at 5:00 PM Mountain Time. Tonight is ${dateStr}.

YOUR JOB
Write the spoken script for an anchor (Nicholas) to read on camera. Five stories. Cold open, five segments with clean transitions, sign-off. The audience is Missoula residents catching the news on their commute home.

HARD CONSTRAINTS
  1. Word count: between ${WORD_MIN} and ${WORD_MAX} words total. This delivers ~90 seconds at ${WPM_TARGET} wpm. Count every word including articles. Do not exceed ${WORD_MAX}. Do not fall below ${WORD_MIN}.
  2. Every story must include explicit source attribution by outlet name. Examples: "the Missoulian reports", "according to the Missoula Current", "per the Independent Record", "KGVO News says". Pick the phrasing that flows.
  3. Cover all five stories. Lead with the most important. End with the lightest.
  4. No invented facts. Every name, number, date, dollar amount, and location must appear in the article text I gave you. If the source didn't say it, the script doesn't say it.
  5. Conversational but objective. American English. Contractions OK. No rhetorical questions. No editorial framing ("shockingly", "remarkably", "in a stunning move"). No first-person opinion. No second-person ("you should care about this").
  6. Banned phrases. Do NOT use any of these, in any form:
${bannedList}
  7. No em-dashes (-). Use commas or sentence breaks. Em-dashes cause HeyGen to mis-pace.
  8. Open with a tight cold open ("Good evening, Missoula. I'm Nicholas. Here's your ZooTown Minute for ${dateStr}.")
  9. End with a clean sign-off ("That's your ZooTown Minute. I'm Nicholas, we'll see you tomorrow.")

CADENCE GUIDE
  - First sentence of each story: the news. The thing that happened. Subject, verb, plain.
  - Second sentence: the why or the detail that matters.
  - Optional third sentence: attribution + one more fact, only if there's room.
  - Transitions are short. "Next." "Across town." "Also today." "In other news." Don't write essays between stories.

TONIGHT'S FIVE STORIES (in priority order):

${storyBlock}

OUTPUT
Return STRICT JSON only. No prose outside the JSON. No markdown fences.
INSIDE the "script" string value do NOT use any double-quote characters. Paraphrase any quoted source material instead of quoting it. If you must include a possessive 's, that's fine. Double quotes inside the script field break JSON parsing.

{
  "script": "<the full script as a single string, anchor's spoken words only, no stage directions, no [pause] tags>",
  "attributions": [
    { "story_id": <id>, "source_name": "<name>", "source_url": "<url>" }
  ]
}${retry}`;
}

async function callGemini(prompt: string): Promise<{ script: string; attributions: any[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4, // factual, low creativity
      maxOutputTokens: 1500,
      // No responseMimeType - the json mode has been silently corrupting
      // strings that contain double quotes. We parse + repair manually.
    },
  };
  // Retry on transient 5xx / 429. Gemini 'high demand' (503) is very common.
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
      // exponential backoff: 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, 2000 * (1 << i)));
      continue;
    }
    throw new Error(lastErr);
  }
  if (!res || !res.ok) throw new Error(lastErr || "Gemini unavailable");
  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const fb = cleaned.indexOf("{");
  const lb = cleaned.lastIndexOf("}");
  if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);

  // Try strict parse first.
  try {
    const parsed = JSON.parse(cleaned);
    return {
      script: String(parsed.script ?? "").trim(),
      attributions: Array.isArray(parsed.attributions) ? parsed.attributions : [],
    };
  } catch {
    // Fallback 1: tolerant regex extraction. Find script value as the chunk
    // between the first "script": " and the LAST " before "attributions" or
    // end-of-string. Handles unescaped internal quotes.
    const headIdx = cleaned.search(/"script"\s*:\s*"/);
    if (headIdx >= 0) {
      const valueStart = cleaned.indexOf('"', cleaned.indexOf(":", headIdx)) + 1;
      const attribIdx = cleaned.search(/"attributions"\s*:/);
      // The end of the script value is the closing ", just before the comma
      // and "attributions" key (if present) or the closing brace.
      let valueEnd: number;
      if (attribIdx > valueStart) {
        valueEnd = cleaned.lastIndexOf('"', attribIdx - 1);
        // step back over the comma if present
        valueEnd = cleaned.lastIndexOf('"', valueEnd);
        // simpler: scan backward from attribIdx for the nearest quote
        for (let i = attribIdx - 1; i > valueStart; i--) {
          if (cleaned[i] === '"') { valueEnd = i; break; }
        }
      } else {
        valueEnd = cleaned.lastIndexOf('"');
      }
      if (valueEnd > valueStart) {
        const raw = cleaned.slice(valueStart, valueEnd)
          .replace(/\\n/g, " ")
          .replace(/\\"/g, '"')
          .replace(/\s+/g, " ")
          .trim();
        const attribMatch = cleaned.match(/"attributions"\s*:\s*(\[[\s\S]*?\])/);
        let attributions: any[] = [];
        if (attribMatch) {
          try { attributions = JSON.parse(attribMatch[1]); } catch { /* ignore */ }
        }
        return { script: raw, attributions };
      }
    }
    // Absolute last resort: return the whole cleaned text as the script.
    // Validator will catch it and we'll retry.
    return { script: cleaned.slice(0, 4000), attributions: [] };
  }
}

/**
 * Main entry: generate a validated script. Will re-ask Gemini up to 2 times
 * if the first draft violates word count or uses a banned phrase.
 */
export async function generateZootownMinuteScript(
  stories: ScriptStoryInput[],
): Promise<ScriptResult> {
  if (stories.length === 0) throw new Error("no stories supplied");
  if (stories.length > 5) stories = stories.slice(0, 5);

  const warnings: string[] = [];
  let retryNote: string | undefined;
  let lastResult: { script: string; attributions: any[] } | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = buildPrompt(stories, retryNote);
    lastResult = await callGemini(prompt);
    const wc = countWords(lastResult.script);
    const banned = findBannedPhrases(lastResult.script);
    const hasEmDash = /[\u2014\u2013]/.test(lastResult.script);
    // Attribution check: every story id should have at least one attribution
    // OR the source name should appear in the script verbatim.
    const missingAttrib = stories.filter((s) => {
      const named = lastResult!.attributions.some((a) => Number(a.story_id) === s.id);
      const verbatim = lastResult!.script.toLowerCase().includes(s.source_name.toLowerCase());
      return !(named || verbatim);
    });

    const problems: string[] = [];
    if (wc < WORD_MIN) problems.push(`Word count ${wc} is below minimum ${WORD_MIN}. Add a sentence or two of source-supported detail.`);
    if (wc > WORD_MAX) problems.push(`Word count ${wc} exceeds maximum ${WORD_MAX}. Tighten - drop a sentence or shorten transitions.`);
    if (banned.length) problems.push(`Contains banned phrases: ${banned.map((p) => `"${p}"`).join(", ")}. Remove them and rephrase.`);
    if (hasEmDash) problems.push(`Contains em-dash or en-dash. Replace with comma or period.`);
    if (missingAttrib.length) problems.push(`These stories are not attributed by source name: ${missingAttrib.map((s) => `id ${s.id} (${s.source_name})`).join(", ")}. Each story must say the outlet name out loud.`);

    if (problems.length === 0) {
      return {
        script: lastResult.script,
        word_count: wc,
        estimated_seconds: Math.round((wc / WPM_TARGET) * 60 * 10) / 10,
        attributions: lastResult.attributions,
        attempts: attempt,
        warnings,
      };
    }

    warnings.push(`attempt ${attempt}: ${problems.join(" | ")}`);
    if (attempt < 3) {
      retryNote = problems.join("\n");
    }
  }

  // Ran out of attempts - return the last try with warnings so caller can decide.
  const wc = countWords(lastResult!.script);
  return {
    script: lastResult!.script,
    word_count: wc,
    estimated_seconds: Math.round((wc / WPM_TARGET) * 60 * 10) / 10,
    attributions: lastResult!.attributions,
    attempts: 3,
    warnings,
  };
}
