/**
 * Phase 29: retire the Health desk.
 *
 * One-time pass that reads every story currently on desk='health' and asks
 * Gemini whether it belongs on city / business / people, or whether it
 * should stay where it is (low-confidence / not-MT national wire).
 *
 * Per editorial discussion June 14:
 *   - Don't trash anything. Just reclassify clearly-MT stories.
 *   - National wire stays put on the legacy 'health' desk in the DB; the
 *     desk is removed from the public nav so those rows are effectively
 *     archived from the reader's perspective.
 *   - Every reclassification gets logged to story_edits so the trail is
 *     intact.
 *
 * Confidence floor: 0.8. If Gemini is uncertain it leaves the story alone.
 */
import { sql } from "drizzle-orm";
import { db, storage } from "../storage.js";

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const ALLOWED_TARGETS = new Set(["city", "business", "people", "health"]);

const SYSTEM_PROMPT = `You are reclassifying Montana local-news stories that were tagged 'health'. The ZooTown editorial team has retired the Health desk because most so-called health stories are either national wire copy or PR rather than local news.

For each story you read, decide:
  - city     : public health emergencies, water/air quality, governance, policy, Medicaid, healthcare regulation, government action, anything tied to MT government or community safety.
  - business : hospital openings, expansions, new clinics, economic news about healthcare institutions, employer/employment news.
  - people   : profiles of named local nurses, doctors, healthcare workers, survivors, retirements.
  - health   : leave alone. Use this when the story is national wire copy unrelated to Montana, or when you're not confident any other desk fits.

Return STRICT JSON:
  { "target": "city"|"business"|"people"|"health", "confidence": 0..1, "reason": "<one short sentence>" }

Confidence rules:
  - 0.9+ : explicit. The story is clearly about MT governance, a specific MT business, or a named MT person.
  - 0.7-0.8 : strong inference. MT context is implicit but clear.
  - <0.7 : not confident. Return target="health" so we leave it alone.

Be conservative. When in doubt, leave it as health. Output JSON only, no prose.`;

interface ReclassifyResult {
  target: string;
  confidence: number;
  reason: string;
}

async function classifyOne(headline: string, summary: string, sourceName: string): Promise<ReclassifyResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const userText = `STORY:
Headline: ${headline}
Source: ${sourceName}
Summary: ${(summary ?? "").slice(0, 800)}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const target = String(parsed.target ?? "health").toLowerCase();
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  const reason = String(parsed.reason ?? "").slice(0, 200);
  if (!ALLOWED_TARGETS.has(target)) return { target: "health", confidence: 0, reason: "invalid target" };
  return { target, confidence, reason };
}

export interface RetireReport {
  scanned: number;
  rerouted: number;
  left_alone: number;
  failures: number;
  by_target: Record<string, number>;
  samples: Array<{ id: number; from: string; to: string; confidence: number; reason: string; headline: string }>;
}

export async function retireHealthDesk(opts: { limit?: number; dryRun?: boolean } = {}): Promise<RetireReport> {
  const limit = opts.limit ?? 500;
  const dryRun = !!opts.dryRun;
  const rows = (await db.execute(sql`
    SELECT id, headline, summary, source_name
    FROM stories
    WHERE desk = 'health' AND mod_state NOT IN ('rejected','trashed')
    ORDER BY id ASC
    LIMIT ${limit}
  `)) as unknown as Array<{ id: number; headline: string; summary: string | null; source_name: string }>;

  const report: RetireReport = {
    scanned: 0,
    rerouted: 0,
    left_alone: 0,
    failures: 0,
    by_target: { city: 0, business: 0, people: 0, health: 0 },
    samples: [],
  };

  for (const row of rows) {
    report.scanned++;
    let cls: ReclassifyResult;
    try {
      cls = await classifyOne(row.headline, row.summary ?? "", row.source_name);
    } catch (err) {
      report.failures++;
      continue;
    }

    report.by_target[cls.target] = (report.by_target[cls.target] ?? 0) + 1;

    const willReroute = cls.target !== "health" && cls.confidence >= 0.8;

    if (willReroute) {
      report.rerouted++;
      if (!dryRun) {
        await db.execute(sql`
          UPDATE stories
          SET desk = ${cls.target}, is_reviewed = true, reviewed_at = NOW()::text
          WHERE id = ${row.id}
        `);
        // Log to story_edits so the trail survives in training data.
        await db.execute(sql`
          INSERT INTO story_edits (story_id, field, before_value, after_value, source_name, edited_at)
          VALUES (${row.id}, 'desk', 'health', ${cls.target}, ${row.source_name}, NOW()::text)
        `);
      }
      if (report.samples.length < 25) {
        report.samples.push({
          id: row.id,
          from: "health",
          to: cls.target,
          confidence: cls.confidence,
          reason: cls.reason,
          headline: row.headline,
        });
      }
    } else {
      report.left_alone++;
    }
  }

  return report;
}
