/**
 * Phase 21: Gemini-backed desk sanity check.
 *
 * The regex desk_misroute check in editorial-audit catches mechanical
 * obvious cases (obit on city desk, sports recap on entertainment, etc).
 * This Gemini layer catches the editorial calls a regex can't: a Bozeman
 * mayor story on the business desk, a school board meeting on city
 * instead of people, a startup raise on community instead of business.
 *
 * Strategy:
 *   - Sample N recent stories per pass (rotating set so we hit everything
 *     within a week)
 *   - Skip anything ZooTown synthesized, anything pinned, anything
 *     already audited as a misroute, and anything on_calendar=true
 *   - Batch ~10 stories per Gemini call to amortize tokens
 *   - Gemini returns {storyId, suggestedDesk, confidence, reasoning} per
 *     story; we only file an audit row when current_desk != suggestedDesk
 *     AND confidence >= 0.75
 *
 * Cost control: ~50 stories/day at ~150 tokens each = ~7,500 tokens/day,
 * well inside the Gemini Flash free tier.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../storage.js";

// Use the stable flash latest pointer so we don't have to chase model name
// changes. gemini-1.5-flash was retired; gemini-flash-latest currently
// resolves to a 2.x flash variant.
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const BATCH_SIZE = 10;
const CONFIDENCE_THRESHOLD = 0.75;
const SAMPLE_AGE_HOURS = 72;

// Same desk taxonomy as shared/schema.ts. Mirrored here as a typed string
// list so the prompt has the exact allowed values.
const DESKS = [
  "city", "business", "crime", "sports", "health",
  "entertainment", "people", "history",
] as const;
type Desk = (typeof DESKS)[number];

interface InputStory {
  id: number;
  headline: string;
  summary: string | null;
  current_desk: string;
  source_name: string;
}

interface GeminiVerdict {
  storyId: number;
  suggestedDesk: Desk;
  confidence: number;       // 0-1
  reasoning: string;
}

const SYSTEM_PROMPT = `You are an editorial desk auditor for a Montana local news aggregator.

For each story, decide whether its CURRENT desk classification is correct, and what the best desk would be.

Allowed desks (you MUST return one of these exact strings):
- city         - city/county government, civic issues, infrastructure, local politics
- business     - companies, jobs, real estate, economy, startups, agriculture economics
- crime        - arrests, court cases, criminal investigations, public safety incidents
- sports       - games, athletic events, recaps, sports profiles
- health       - hospitals, public health, medical research, healthcare access
- entertainment - concerts, theater, art, festivals, food/dining, museums
- people       - profiles of individuals (positive only): obits, athlete features,
                 community leaders, historical figures, anniversaries
- history      - historical events, anniversaries of past events (not living people)

Editorial rules to honor:
- Crime is crime, not politics — never route an arrest to "city" even if the suspect is political.
- Federal/national politics: only Montana-relevant; default to "city" if it touches MT government.
- Obits and historical profiles -> "people".
- Sports recaps with a Montana team -> "sports".
- School board meetings -> "city" (governance), not "people".

Return STRICT JSON with this exact shape:
{
  "verdicts": [
    { "storyId": <number>, "suggestedDesk": "<desk>", "confidence": <0-1>, "reasoning": "<one short sentence>" }
  ]
}

Confidence rubric:
- 0.9+ = obvious misroute (e.g. an obit currently on "city")
- 0.7-0.9 = strong opinion, defensible disagreement possible
- 0.5-0.7 = arguable, the current desk could be valid
- <0.5 = current desk is fine, just slightly off`;

async function callGemini(stories: InputStory[]): Promise<GeminiVerdict[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const userText = `Audit these ${stories.length} stories. For each one, decide whether the current desk is correct.\n\n` +
    stories
      .map(
        (s) =>
          `Story ${s.id} [current desk: ${s.current_desk}] [source: ${s.source_name}]\nHeadline: ${s.headline}\nSummary: ${(s.summary ?? "").slice(0, 400)}\n`,
      )
      .join("\n---\n");

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
  const verdicts = parsed?.verdicts;
  if (!Array.isArray(verdicts)) throw new Error("Gemini response missing verdicts array");
  return verdicts.filter(
    (v: any) =>
      typeof v?.storyId === "number" &&
      DESKS.includes(v?.suggestedDesk) &&
      typeof v?.confidence === "number",
  );
}

function fp(parts: (string | number)[]): string {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
}

export interface DeskSanityReport {
  storiesSampled: number;
  batchesCalled: number;
  verdictsReturned: number;
  misroutesFound: number;
  inserted: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

export async function runDeskSanity(opts?: {
  limit?: number;
  ageHours?: number;
}): Promise<DeskSanityReport> {
  const t0 = Date.now();
  const limit = opts?.limit ?? 30;
  const ageHours = opts?.ageHours ?? SAMPLE_AGE_HOURS;
  const report: DeskSanityReport = {
    storiesSampled: 0,
    batchesCalled: 0,
    verdictsReturned: 0,
    misroutesFound: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  };

  // Sample: prefer stories Gemini hasn't already audited.
  // The fingerprint pattern lets us filter cheaply: any existing
  // 'desk_misroute' audit with fingerprint starting "gemini-<id>"
  // means we've already looked.
  const rows = (await db.execute(sql`
    SELECT id, headline, summary, desk AS current_desk, source_name
    FROM stories s
    WHERE published_at >= (NOW() - INTERVAL '1 hour' * ${ageHours})::text
      AND mod_state <> 'rejected'
      AND on_calendar = false
      AND is_synthesis = false
      AND pinned_at IS NULL
      AND is_obituary = false
      AND NOT EXISTS (
        SELECT 1 FROM editorial_audits ea
        WHERE ea.kind = 'desk_misroute'
          AND ea.fingerprint = 'gemini-' || s.id
      )
    ORDER BY RANDOM()
    LIMIT ${limit}
  `)) as unknown as InputStory[];

  report.storiesSampled = rows.length;
  if (rows.length === 0) {
    report.durationMs = Date.now() - t0;
    return report;
  }

  // Batch into Gemini calls.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    report.batchesCalled++;
    try {
      const verdicts = await callGemini(batch);
      report.verdictsReturned += verdicts.length;

      // Index input batch for lookups.
      const byId = new Map(batch.map((b) => [b.id, b]));

      for (const v of verdicts) {
        const story = byId.get(v.storyId);
        if (!story) continue;
        if (v.suggestedDesk === story.current_desk) continue;
        if (v.confidence < CONFIDENCE_THRESHOLD) continue;
        report.misroutesFound++;

        const fingerprint = `gemini-${story.id}`;
        const title = `#${story.id} routed to ${story.current_desk}, Gemini says ${v.suggestedDesk} (${Math.round(v.confidence * 100)}%)`;
        const detail = `Headline: "${story.headline}"\n\nGemini reasoning: ${v.reasoning}`;
        const severity = v.confidence >= 0.9 ? "high" : "medium";

        const ins = (await db.execute(sql`
          INSERT INTO editorial_audits (kind, severity, status, title, detail,
            subject_story_ids, suggested_action, fingerprint)
          VALUES ('desk_misroute', ${severity}, 'open', ${title}, ${detail},
            ${[story.id] as any}, ${`UPDATE stories SET desk='${v.suggestedDesk}' WHERE id=${story.id};`},
            ${fingerprint})
          ON CONFLICT (kind, fingerprint) DO NOTHING
          RETURNING id
        `)) as unknown as { id: number }[];
        if (ins.length > 0) report.inserted++;
        else report.skipped++;
      }
    } catch (err: any) {
      report.errors.push(`batch ${i / BATCH_SIZE + 1}: ${err?.message ?? err}`);
    }
  }

  report.durationMs = Date.now() - t0;
  return report;
}
