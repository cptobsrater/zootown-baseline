/**
 * Phase 26: conversational training layer.
 *
 * The admin opens a story's chat thread and types something like:
 *   "this should be on the people desk, not city - it's a profile about
 *    the new librarian, and Hamilton always cares about people stories"
 *
 * Gemini reads the message, the story context, and recent conversation
 * history, then returns two things:
 *   1. A short conversational reply for the admin to see ("Got it. I'll
 *      reroute this to people and remember Hamilton leans toward
 *      community-figure profiles.").
 *   2. A list of structured signals to persist (e.g. desk_reroute on
 *      this story; city_voice note for Hamilton).
 *
 * Each signal becomes a learned_signals row. Some kinds get auto-applied
 * inline (desk_reroute updates the story now; source_trust_bump nudges
 * sources.trust_score now). Others (more_like_this, editorial_note,
 * city_voice) accumulate for future classifier passes.
 *
 * Editorial principle: the conversation is the trail. Even when the
 * extraction misses something, the verbatim admin message is preserved
 * so we can re-extract later with a better prompt.
 */
import { sql } from "drizzle-orm";
import { db, storage } from "../storage.js";

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const VALID_DESKS = new Set([
  "city", "business", "crime", "sports", "health",
  "entertainment", "people", "history",
]);
const VALID_KINDS = new Set([
  "desk_reroute", "desk_rule", "source_trust_bump",
  "more_like_this", "less_like_this", "editorial_note", "city_voice",
]);

interface ExtractedSignal {
  kind: string;
  subject: string;
  target?: string | null;
  value?: string | null;
  confidence?: number;
}
interface DraftPatch {
  headline?: string;
  summary?: string;
  why_it_matters?: string;
  desk?: string;
  tags?: string[];
  rationale?: string;
}
interface GeminiOutput {
  reply: string;
  signals: ExtractedSignal[];
  draft?: DraftPatch | null;
}

const SYSTEM_PROMPT = `You are the editorial brain of ZooTown, a Montana local-news aggregator. The admin is teaching you about a specific story by talking to you.

Your job per message:
  1) Read what the admin said, the story they're on, the existing draft (if any), and recent chat history.
  2) Decide which (zero or more) structured signals to extract.
  3) If the admin is asking for content changes to the story itself (better headline, tighter summary, fix a fact, change tone), produce a NEW COMPLETE DRAFT incorporating the cumulative feedback from the whole thread \u2014 ignore obvious nonsense or contradictory noise. Always rewrite the full story (headline + summary + why_it_matters), not just the field they mentioned, because the fields need to read coherently together. If the admin is NOT asking for content changes, omit the draft field entirely.
  4) Write a SHORT, friendly reply (1-2 sentences). If you produced a draft, say so (\"Draft 3 is ready \u2014 take a look.\").
  5) Return STRICT JSON with this exact shape:
     {
       "reply": "<short admin-facing reply>",
       "signals": [ ... see below ... ],
       "draft": {
         "headline": "<new headline>",
         "summary": "<new summary, 1-3 sentences>",
         "why_it_matters": "<new why-it-matters, 1 sentence>",
         "desk": "<one of allowed desks, usually unchanged>",
         "tags": ["tag1", "tag2"],
         "rationale": "<one sentence: what you changed and why>"
       }
     }
  Set draft to null (or omit) when no content change is warranted.

Signals shape:
  signals: [
    { "kind": "<one of allowed kinds>",
      "subject": "<string per the kind's convention>",
      "target": "<string|null>",
      "value": "<string|null>",
      "confidence": <0..1> }
  ]

Allowed signal kinds and their conventions:

  desk_reroute       This single story belongs on a different desk.
    subject="story:<id>"  target=<old_desk>  value=<new_desk>

  desk_rule          A general rule: future stories matching a headline
                     pattern from this source should go to a desk.
    subject="source:<source_name>"  target=<headline_keyword>  value=<desk>

  source_trust_bump  Raise or lower how much we trust this source.
    subject="source:<source_name>"  target=null  value="+5" or "-10"

  more_like_this     The admin likes this kind of story; signal classifiers
                     to surface similar ones.
    subject="story:<id>"  target="liked"  value=<short why-phrase>

  less_like_this     The admin doesn't want stories like this; classifiers
                     should de-emphasize similar ones.
    subject="story:<id>"  target="disliked"  value=<short why-phrase>

  editorial_note     Freeform note tied to this story; doesn't affect
                     classifiers automatically but preserves admin reasoning.
    subject="story:<id>"  target=null  value=<the note verbatim>

  city_voice         Editorial preference for an entire city.
    subject="city:<city_slug>"  target=null  value=<short pref, e.g. "leans toward profiles of named locals">

Allowed desks: city, business, crime, sports, health, entertainment, people, history.

Editorial rules to honor:
  - Crime is crime, not politics.
  - Federal politics: only Montana-relevant; default to "city" desk if it touches MT government.
  - Obits and historical profiles -> "people".
  - Sports recaps with a Montana team -> "sports".
  - School board meetings -> "city" (governance), not "people".
  - Wins (not losses) are what we elevate for sports.
  - "Stay out of politics" is a posture, not a hard rule - substantive political stories can run; trash-talk and division-as-content cannot.

If the admin's message is just praise ("good story!") or just a question with no actionable signal, return signals=[] and a friendly reply. Don't invent signals.

If the admin types something like "approved", "looks good", "ship it", "that one", they are accepting the latest draft \u2014 do NOT produce a new draft, just reply confirming. The frontend handles the actual approval click.

If the admin's message is nonsense or contradicts itself, reply asking for clarification and do not produce a draft.

Be conservative with confidence: 0.9+ only when the admin was explicit; 0.5-0.7 for inferences; never below 0.5 (if confidence is lower, omit the signal).

Output JSON only. No markdown fences. No prose outside the JSON object.`;

interface ChatContext {
  storyId: number;
  storyHeadline: string;
  storySummary: string;
  storyWhyItMatters?: string | null;
  storyDesk: string;
  storySourceName: string;
  storyCitySlug: string | null;
  // Latest draft state (live story or most recent draft).
  latestDraft?: {
    version: number;
    headline: string;
    summary: string | null;
    whyItMatters: string | null;
  } | null;
  // Last few turns (oldest first) for continuity.
  history: { role: "admin" | "ai"; message: string }[];
  adminMessage: string;
}

async function callGemini(ctx: ChatContext): Promise<GeminiOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const draftBlock = ctx.latestDraft
    ? `\n\nLATEST DRAFT v${ctx.latestDraft.version}:\nHeadline: ${ctx.latestDraft.headline}\nSummary: ${(ctx.latestDraft.summary ?? "").slice(0, 800)}\nWhy it matters: ${(ctx.latestDraft.whyItMatters ?? "").slice(0, 400)}`
    : "";
  const storyBlock = `Story #${ctx.storyId} [desk: ${ctx.storyDesk}] [source: ${ctx.storySourceName}] [city: ${ctx.storyCitySlug ?? "?"}]
Live Headline: ${ctx.storyHeadline}
Live Summary: ${(ctx.storySummary ?? "").slice(0, 600)}
Live Why it matters: ${(ctx.storyWhyItMatters ?? "").slice(0, 400)}${draftBlock}`;

  const historyBlock = ctx.history.length === 0
    ? "(no prior turns)"
    : ctx.history.map((t) => `[${t.role}]: ${t.message}`).join("\n");

  const userText =
    `STORY CONTEXT:\n${storyBlock}\n\n` +
    `PRIOR TURNS (oldest first):\n${historyBlock}\n\n` +
    `NEW ADMIN MESSAGE:\n${ctx.adminMessage}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
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
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
  const draft = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : null;
  return {
    reply: String(parsed.reply ?? "Noted."),
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    draft,
  };
}

function sanitizeDraft(d: DraftPatch | null | undefined): DraftPatch | null {
  if (!d || typeof d !== "object") return null;
  const headline = typeof d.headline === "string" ? d.headline.trim() : "";
  if (!headline) return null;
  const desk = typeof d.desk === "string" && VALID_DESKS.has(d.desk) ? d.desk : undefined;
  const tags = Array.isArray(d.tags)
    ? d.tags.filter((t) => typeof t === "string" && t.trim().length > 0).map((t) => String(t).trim()).slice(0, 12)
    : undefined;
  return {
    headline: headline.slice(0, 300),
    summary: typeof d.summary === "string" ? d.summary.trim().slice(0, 2000) : undefined,
    why_it_matters: typeof d.why_it_matters === "string" ? d.why_it_matters.trim().slice(0, 1000) : undefined,
    desk,
    tags,
    rationale: typeof d.rationale === "string" ? d.rationale.trim().slice(0, 500) : undefined,
  };
}

function validateSignal(s: ExtractedSignal): ExtractedSignal | null {
  if (!s || typeof s !== "object") return null;
  if (!VALID_KINDS.has(s.kind)) return null;
  if (typeof s.subject !== "string" || !s.subject) return null;
  if (s.kind === "desk_reroute") {
    if (!VALID_DESKS.has(String(s.value ?? ""))) return null;
  }
  if (s.kind === "desk_rule") {
    if (!VALID_DESKS.has(String(s.value ?? ""))) return null;
  }
  if (s.kind === "source_trust_bump") {
    const n = Number(s.value);
    if (!Number.isFinite(n) || Math.abs(n) > 100) return null;
  }
  const conf = Number(s.confidence ?? 0.7);
  if (!Number.isFinite(conf) || conf < 0.5) return null;
  return { ...s, confidence: conf };
}

// ─── Signal application ───────────────────────────────────────────────────
//
// Some kinds change the world right now. Others just accumulate.
// Application notes are stored on learned_signals.application_note so the
// admin can see what actually happened.

async function applySignal(
  signal: ExtractedSignal,
  signalRowId: number,
  storyId: number,
): Promise<string | null> {
  try {
    if (signal.kind === "desk_reroute") {
      const newDesk = String(signal.value);
      const m = signal.subject.match(/^story:(\d+)$/);
      const targetId = m ? Number(m[1]) : storyId;
      await db.execute(sql`
        UPDATE stories
        SET desk = ${newDesk}, is_reviewed = true, reviewed_at = NOW()::text
        WHERE id = ${targetId}
      `);
      return `Rerouted story #${targetId} to desk='${newDesk}'.`;
    }
    if (signal.kind === "source_trust_bump") {
      const m = signal.subject.match(/^source:(.+)$/);
      const sourceName = m ? m[1] : null;
      const delta = Number(signal.value);
      if (sourceName) {
        const updated = (await db.execute(sql`
          UPDATE sources
          SET trust_score = GREATEST(0, LEAST(100, trust_score + ${delta}))
          WHERE name = ${sourceName}
          RETURNING id, trust_score
        `)) as unknown as { id: number; trust_score: number }[];
        if (updated[0]) return `Bumped ${sourceName} trust by ${delta} -> ${updated[0].trust_score}.`;
        return `Source '${sourceName}' not found; signal stored for later.`;
      }
    }
    // Other kinds are not auto-applied; they sit in learned_signals for
    // classifier passes to consume.
    return null;
  } catch (err: any) {
    return `Failed to apply: ${err?.message ?? err}`;
  }
}

// ─── Public service API ───────────────────────────────────────────────────

export interface ConversationTurn {
  id: number;
  role: "admin" | "ai";
  message: string;
  extractedSignals?: any;
  createdAt: string;
  appliedNotes?: string[];
}

export async function listConversation(storyId: number, limit = 50): Promise<ConversationTurn[]> {
  const rows = (await db.execute(sql`
    SELECT id, role, message, extracted_signals, created_at
    FROM story_conversations
    WHERE story_id = ${storyId}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit}
  `)) as unknown as any[];
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    message: r.message,
    extractedSignals: r.extracted_signals,
    createdAt: r.created_at,
  }));
}

export interface ChatResult {
  adminTurn: ConversationTurn;
  aiTurn: ConversationTurn;
  appliedNotes: string[];
  newDraft?: StoryDraftRow | null;
  error?: string;
}

export interface StoryDraftRow {
  id: number;
  storyId: number;
  version: number;
  headline: string;
  summary: string | null;
  whyItMatters: string | null;
  desk: string | null;
  tags: string[] | null;
  sourceOfChange: string;
  conversationTurnId: number | null;
  status: "draft" | "approved" | "superseded";
  rationale?: string | null;
  createdAt: string;
  approvedAt: string | null;
}

function rowToDraft(r: any): StoryDraftRow {
  return {
    id: r.id,
    storyId: r.story_id,
    version: r.version,
    headline: r.headline,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    desk: r.desk,
    tags: r.tags,
    sourceOfChange: r.source_of_change,
    conversationTurnId: r.conversation_turn_id,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  };
}

async function getLatestDraft(storyId: number): Promise<StoryDraftRow | null> {
  const rows = (await db.execute(sql`
    SELECT id, story_id, version, headline, summary, why_it_matters, desk, tags,
           source_of_change, conversation_turn_id, status, created_at, approved_at
    FROM story_drafts
    WHERE story_id = ${storyId}
    ORDER BY version DESC
    LIMIT 1
  `)) as unknown as any[];
  return rows[0] ? rowToDraft(rows[0]) : null;
}

export async function listDrafts(storyId: number): Promise<StoryDraftRow[]> {
  const rows = (await db.execute(sql`
    SELECT id, story_id, version, headline, summary, why_it_matters, desk, tags,
           source_of_change, conversation_turn_id, status, created_at, approved_at
    FROM story_drafts
    WHERE story_id = ${storyId}
    ORDER BY version ASC
  `)) as unknown as any[];
  return rows.map(rowToDraft);
}

async function ensureSnapshot(storyId: number): Promise<void> {
  // If story has no drafts yet, snapshot the live story as version 1 with status=approved.
  const existing = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM story_drafts WHERE story_id = ${storyId}
  `)) as unknown as { n: number }[];
  if ((existing[0]?.n ?? 0) > 0) return;
  const story = await storage.getStory(storyId);
  if (!story) return;
  await db.execute(sql`
    INSERT INTO story_drafts
      (story_id, version, headline, summary, why_it_matters, desk, tags,
       source_of_change, status, created_at, approved_at)
    VALUES (
      ${storyId}, 1, ${story.headline}, ${story.summary ?? null},
      ${story.whyItMatters ?? null}, ${story.desk}, ${story.tags ?? null},
      'snapshot', 'approved', NOW(), NOW()
    )
  `);
}

async function persistNewDraft(
  storyId: number,
  draft: DraftPatch,
  conversationTurnId: number | null,
): Promise<StoryDraftRow> {
  await ensureSnapshot(storyId);
  // Compute next version.
  const maxRow = (await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) AS max FROM story_drafts WHERE story_id = ${storyId}
  `)) as unknown as { max: number }[];
  const nextVersion = (maxRow[0]?.max ?? 0) + 1;
  const inserted = (await db.execute(sql`
    INSERT INTO story_drafts
      (story_id, version, headline, summary, why_it_matters, desk, tags,
       source_of_change, conversation_turn_id, status)
    VALUES (
      ${storyId}, ${nextVersion}, ${draft.headline ?? ""},
      ${draft.summary ?? null}, ${draft.why_it_matters ?? null},
      ${draft.desk ?? null}, ${draft.tags ?? null},
      'ai', ${conversationTurnId}, 'draft'
    )
    RETURNING id, story_id, version, headline, summary, why_it_matters, desk, tags,
              source_of_change, conversation_turn_id, status, created_at, approved_at
  `)) as unknown as any[];
  const row = rowToDraft(inserted[0]);
  row.rationale = draft.rationale ?? null;
  return row;
}

export async function approveDraft(storyId: number, version: number): Promise<StoryDraftRow> {
  const rows = (await db.execute(sql`
    SELECT id, story_id, version, headline, summary, why_it_matters, desk, tags,
           source_of_change, conversation_turn_id, status, created_at, approved_at
    FROM story_drafts
    WHERE story_id = ${storyId} AND version = ${version}
    LIMIT 1
  `)) as unknown as any[];
  if (!rows[0]) throw new Error("draft not found");
  const target = rowToDraft(rows[0]);

  // Apply to live story.
  await db.execute(sql`
    UPDATE stories
    SET headline = ${target.headline},
        summary = COALESCE(${target.summary}, summary),
        why_it_matters = COALESCE(${target.whyItMatters}, why_it_matters),
        desk = COALESCE(${target.desk}, desk),
        tags = COALESCE(${target.tags}::text[], tags),
        is_reviewed = true,
        reviewed_at = NOW()::text
    WHERE id = ${storyId}
  `);

  // Supersede previous approved drafts.
  await db.execute(sql`
    UPDATE story_drafts
    SET status = 'superseded'
    WHERE story_id = ${storyId} AND status = 'approved' AND version <> ${version}
  `);

  // Mark this one approved.
  const updated = (await db.execute(sql`
    UPDATE story_drafts
    SET status = 'approved', approved_at = NOW()
    WHERE story_id = ${storyId} AND version = ${version}
    RETURNING id, story_id, version, headline, summary, why_it_matters, desk, tags,
              source_of_change, conversation_turn_id, status, created_at, approved_at
  `)) as unknown as any[];
  return rowToDraft(updated[0]);
}

export async function sendAdminMessage(opts: {
  storyId: number;
  message: string;
  adminId: string | null;
  citySlug: string | null;
}): Promise<ChatResult> {
  const { storyId, message, adminId, citySlug } = opts;
  // Hydrate the story.
  const story = await storage.getStory(storyId);
  if (!story) throw new Error("story not found");

  // 1. Persist admin turn first so even if Gemini fails the message is logged.
  const adminInsert = (await db.execute(sql`
    INSERT INTO story_conversations (story_id, role, message, admin_id, city_slug)
    VALUES (${storyId}, 'admin', ${message}, ${adminId}, ${citySlug})
    RETURNING id, role, message, created_at
  `)) as unknown as any[];
  const adminTurn: ConversationTurn = {
    id: adminInsert[0].id,
    role: "admin",
    message,
    createdAt: adminInsert[0].created_at,
  };

  // 2. Build context: last 6 turns for continuity + the latest draft.
  const recent = (await db.execute(sql`
    SELECT role, message FROM story_conversations
    WHERE story_id = ${storyId} AND id < ${adminTurn.id}
    ORDER BY created_at DESC, id DESC
    LIMIT 6
  `)) as unknown as Array<{ role: "admin" | "ai"; message: string }>;
  const history = recent.reverse();
  const latestDraftRow = await getLatestDraft(storyId);

  let gemini: GeminiOutput;
  try {
    gemini = await callGemini({
      storyId,
      storyHeadline: story.headline,
      storySummary: story.summary,
      storyWhyItMatters: (story as any).whyItMatters ?? null,
      storyDesk: story.desk,
      storySourceName: story.sourceName,
      storyCitySlug: citySlug,
      latestDraft: latestDraftRow
        ? {
            version: latestDraftRow.version,
            headline: latestDraftRow.headline,
            summary: latestDraftRow.summary,
            whyItMatters: latestDraftRow.whyItMatters,
          }
        : null,
      history,
      adminMessage: message,
    });
  } catch (err: any) {
    // Persist a graceful AI failure turn so the thread stays consistent.
    const failMsg = `(I couldn't process that message right now: ${String(err?.message ?? err).slice(0, 200)}. Your message is saved \u2014 you can try again or rephrase.)`;
    const aiInsert = (await db.execute(sql`
      INSERT INTO story_conversations (story_id, role, message, admin_id, city_slug)
      VALUES (${storyId}, 'ai', ${failMsg}, ${adminId}, ${citySlug})
      RETURNING id, role, message, created_at
    `)) as unknown as any[];
    return {
      adminTurn,
      aiTurn: {
        id: aiInsert[0].id,
        role: "ai",
        message: failMsg,
        createdAt: aiInsert[0].created_at,
      },
      appliedNotes: [],
      error: String(err?.message ?? err),
    };
  }

  // 3. Validate signals.
  const validSignals = gemini.signals
    .map(validateSignal)
    .filter((s): s is ExtractedSignal => s !== null);

  // 4. Persist AI turn with the extracted signals.
  const aiInsert = (await db.execute(sql`
    INSERT INTO story_conversations (story_id, role, message, extracted_signals, admin_id, city_slug)
    VALUES (
      ${storyId}, 'ai', ${gemini.reply},
      ${JSON.stringify(validSignals)}::jsonb,
      ${adminId}, ${citySlug}
    )
    RETURNING id, role, message, extracted_signals, created_at
  `)) as unknown as any[];
  const aiTurn: ConversationTurn = {
    id: aiInsert[0].id,
    role: "ai",
    message: gemini.reply,
    extractedSignals: validSignals,
    createdAt: aiInsert[0].created_at,
  };

  // 5. Persist each signal + try to auto-apply.
  const appliedNotes: string[] = [];
  for (const sig of validSignals) {
    const insertedRow = (await db.execute(sql`
      INSERT INTO learned_signals
        (conversation_id, story_id, kind, subject, target, value, confidence)
      VALUES (
        ${aiTurn.id}, ${storyId}, ${sig.kind}, ${sig.subject},
        ${sig.target ?? null}, ${sig.value ?? null}, ${sig.confidence ?? 0.7}
      )
      RETURNING id
    `)) as unknown as { id: number }[];
    const signalRowId = insertedRow[0]?.id;
    const note = await applySignal(sig, signalRowId, storyId);
    if (note) {
      appliedNotes.push(note);
      await db.execute(sql`
        UPDATE learned_signals
        SET applied = true, applied_at = NOW(), application_note = ${note}
        WHERE id = ${signalRowId}
      `);
    }
  }

  // 6. If Gemini produced a draft, persist it as a new version.
  let newDraft: StoryDraftRow | null = null;
  const cleanDraft = sanitizeDraft(gemini.draft);
  if (cleanDraft) {
    try {
      newDraft = await persistNewDraft(storyId, cleanDraft, aiTurn.id);
      appliedNotes.push(`Draft v${newDraft.version} created.`);
    } catch (err: any) {
      appliedNotes.push(`Draft creation failed: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }

  return { adminTurn, aiTurn, appliedNotes, newDraft };
}
