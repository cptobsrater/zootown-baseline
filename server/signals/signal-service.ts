/**
 * Phase 24: per-story community feedback (likes, dislikes, shares,
 * reports, views).
 *
 * Public endpoints record signals; aggregates table maintains rolling
 * counts so story-card responses can include totals cheaply. Brigade
 * detection flags suspicious patterns (lots of dislikes from
 * very-fresh sessions) for admin attention but never auto-hides.
 *
 * Editorial principle (per Cody, June 14, 2026):
 *  - Collect every signal.
 *  - Only ACT on reports (admin reviews the reported context).
 *  - Like/dislike data accumulates for future analysis; the system
 *    deliberately holds no opinion on a story based on like/dislike
 *    counts alone.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../storage.js";

// ─── Session cookie ────────────────────────────────────────────────────────

export const SESSION_COOKIE = "zt_sid";
// 400 days, the Chrome max for non-secure persistent cookies.
const SESSION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** Generate a fresh session id. URL-safe, ~22 chars of entropy. */
export function newSessionId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Ensure the request has a session id, creating one (and the DB row)
 * if not. Returns the session id; caller is responsible for sending
 * the Set-Cookie header for new sessions.
 */
export async function ensureSession(
  existingCookie: string | null,
  citySlugHint: string | null,
): Promise<{ sessionId: string; created: boolean }> {
  if (existingCookie && /^[A-Za-z0-9_-]{16,64}$/.test(existingCookie)) {
    // Touch last_seen_at; don't error if the row is missing (legacy cookie).
    const rows = (await db.execute(sql`
      UPDATE reader_sessions
      SET last_seen_at = NOW(),
          city_slug_hint = COALESCE(${citySlugHint}, city_slug_hint)
      WHERE id = ${existingCookie}
      RETURNING id
    `)) as unknown as { id: string }[];
    if (rows.length > 0) return { sessionId: existingCookie, created: false };
    // Cookie present but no row — re-create with same id to preserve identity.
    await db.execute(sql`
      INSERT INTO reader_sessions (id, city_slug_hint)
      VALUES (${existingCookie}, ${citySlugHint})
      ON CONFLICT (id) DO NOTHING
    `);
    return { sessionId: existingCookie, created: false };
  }
  const newId = newSessionId();
  await db.execute(sql`
    INSERT INTO reader_sessions (id, city_slug_hint)
    VALUES (${newId}, ${citySlugHint})
  `);
  return { sessionId: newId, created: true };
}

/** Format the Set-Cookie header value for a fresh session. */
export function sessionCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Max-Age=${SESSION_COOKIE_MAX_AGE}; Path=/; SameSite=Lax; HttpOnly`;
}

/** Read the session cookie from a request's Cookie header. */
export function readSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

// ─── Signal recording ─────────────────────────────────────────────────────

type SignalAction = "view" | "like" | "dislike" | "share" | "report" | "unlike" | "undislike";

export interface SignalInput {
  storyId: number;
  sessionId: string;
  action: SignalAction;
  citySlug?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  // For reports only:
  reason?: string | null;
  comment?: string | null;
  reporterEmail?: string | null;
}

export interface SignalResult {
  ok: boolean;
  reason?: string;        // rejection reason if !ok
  aggregates?: {
    views: number; likes: number; dislikes: number; shares: number; reports: number;
    brigadeFlag: boolean;
  };
  userState?: {           // what this session has done to this story
    liked: boolean;
    disliked: boolean;
    shared: boolean;
    reported: boolean;
  };
}

const VIEW_DEDUP_HOURS = 1;
const LIKE_DEDUP_INFINITE = true;   // one like per session per story, ever (toggle via unlike)

/**
 * Insert a signal row, update the aggregates, and check for brigade
 * patterns. Idempotent semantics:
 *  - view: deduped per (session, story, hour)
 *  - like: only one active like per (session, story); 'like' after a 'like'
 *          is a no-op, 'unlike' clears it
 *  - dislike: same as like
 *  - share: not deduped (sharing twice = signal twice)
 *  - report: deduped per (session, story) ever; only one report per session
 */
export async function recordSignal(input: SignalInput): Promise<SignalResult> {
  const { storyId, sessionId, action } = input;

  // Validate story exists.
  const exists = (await db.execute(sql`
    SELECT id FROM stories WHERE id = ${storyId} LIMIT 1
  `)) as unknown as { id: number }[];
  if (exists.length === 0) {
    return { ok: false, reason: "story not found" };
  }

  // Per-action dedup / toggle logic.
  if (action === "view") {
    const recent = (await db.execute(sql`
      SELECT id FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId} AND action = 'view'
        AND created_at > NOW() - INTERVAL '${sql.raw(String(VIEW_DEDUP_HOURS))} hours'
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (recent.length > 0) {
      return { ok: true, aggregates: await readAggregates(storyId), userState: await readUserState(storyId, sessionId) };
    }
  } else if (action === "like" || action === "dislike") {
    // If session already has this action active, no-op.
    const active = (await db.execute(sql`
      SELECT id FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId} AND action = ${action}
        AND NOT EXISTS (
          SELECT 1 FROM story_signals s2
          WHERE s2.story_id = story_signals.story_id
            AND s2.session_id = story_signals.session_id
            AND s2.action = ${action === "like" ? "unlike" : "undislike"}
            AND s2.created_at > story_signals.created_at
        )
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (active.length > 0) {
      return { ok: true, aggregates: await readAggregates(storyId), userState: await readUserState(storyId, sessionId) };
    }
    // Mutual exclusion: liking auto-clears a prior dislike.
    const opposite = action === "like" ? "dislike" : "like";
    const oppositeUndo = action === "like" ? "undislike" : "unlike";
    const oppositeActive = (await db.execute(sql`
      SELECT id FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId} AND action = ${opposite}
        AND NOT EXISTS (
          SELECT 1 FROM story_signals s2
          WHERE s2.story_id = story_signals.story_id
            AND s2.session_id = story_signals.session_id
            AND s2.action = ${oppositeUndo}
            AND s2.created_at > story_signals.created_at
        )
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (oppositeActive.length > 0) {
      // Implicit "undo opposite" first.
      await insertSignal({ ...input, action: oppositeUndo as SignalAction });
      await bumpAggregate(storyId, oppositeUndo as SignalAction);
    }
  } else if (action === "unlike" || action === "undislike") {
    // Idempotent: if no active like/dislike, ignore.
    const target = action === "unlike" ? "like" : "dislike";
    const active = (await db.execute(sql`
      SELECT id FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId} AND action = ${target}
        AND NOT EXISTS (
          SELECT 1 FROM story_signals s2
          WHERE s2.story_id = story_signals.story_id
            AND s2.session_id = story_signals.session_id
            AND s2.action = ${action}
            AND s2.created_at > story_signals.created_at
        )
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (active.length === 0) {
      return { ok: true, aggregates: await readAggregates(storyId), userState: await readUserState(storyId, sessionId) };
    }
  } else if (action === "report") {
    if (!input.reporterEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.reporterEmail)) {
      return { ok: false, reason: "report requires a valid email" };
    }
    if (!input.reason) {
      return { ok: false, reason: "report requires a reason" };
    }
    // One report per session per story, ever.
    const prior = (await db.execute(sql`
      SELECT id FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId} AND action = 'report'
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (prior.length > 0) {
      return { ok: false, reason: "you have already reported this story" };
    }
  }

  await insertSignal(input);
  await bumpAggregate(storyId, action);

  // Brigade detection for like/dislike/report only (views and shares aren't gated).
  if (action === "like" || action === "dislike" || action === "report") {
    await checkBrigade(storyId);
  }

  return {
    ok: true,
    aggregates: await readAggregates(storyId),
    userState: await readUserState(storyId, sessionId),
  };
}

async function insertSignal(input: SignalInput): Promise<void> {
  await db.execute(sql`
    INSERT INTO story_signals
      (story_id, session_id, action, reason, comment, reporter_email,
       city_slug, user_agent, referrer)
    VALUES
      (${input.storyId}, ${input.sessionId}, ${input.action},
       ${input.reason ?? null}, ${input.comment ?? null}, ${input.reporterEmail ?? null},
       ${input.citySlug ?? null}, ${input.userAgent ?? null}, ${input.referrer ?? null})
  `);
  await db.execute(sql`
    UPDATE reader_sessions
    SET signal_count = signal_count + 1, last_seen_at = NOW()
    WHERE id = ${input.sessionId}
  `);
}

async function bumpAggregate(storyId: number, action: SignalAction): Promise<void> {
  // Upsert: ensure a row exists, then update the right counter.
  await db.execute(sql`
    INSERT INTO signal_aggregates (story_id)
    VALUES (${storyId})
    ON CONFLICT (story_id) DO NOTHING
  `);
  const col = ({
    view: "view_count",
    like: "like_count",
    dislike: "dislike_count",
    share: "share_count",
    report: "report_count",
    unlike: "like_count",       // decrement
    undislike: "dislike_count", // decrement
  } as Record<SignalAction, string>)[action];
  const delta = action === "unlike" || action === "undislike" ? -1 : 1;
  // sql.raw is safe here — col/delta are from the controlled map above.
  await db.execute(sql.raw(`
    UPDATE signal_aggregates
    SET ${col} = GREATEST(0, ${col} + (${delta})),
        updated_at = NOW()
    WHERE story_id = ${storyId}
  `));
}

async function readAggregates(storyId: number) {
  const rows = (await db.execute(sql`
    SELECT view_count, like_count, dislike_count, share_count, report_count, brigade_flag
    FROM signal_aggregates WHERE story_id = ${storyId}
  `)) as unknown as Array<{
    view_count: number; like_count: number; dislike_count: number;
    share_count: number; report_count: number; brigade_flag: boolean;
  }>;
  const r = rows[0] ?? { view_count: 0, like_count: 0, dislike_count: 0, share_count: 0, report_count: 0, brigade_flag: false };
  return {
    views: r.view_count, likes: r.like_count, dislikes: r.dislike_count,
    shares: r.share_count, reports: r.report_count, brigadeFlag: r.brigade_flag,
  };
}

async function readUserState(storyId: number, sessionId: string) {
  const rows = (await db.execute(sql`
    WITH actions AS (
      SELECT action, MAX(created_at) AS last_at
      FROM story_signals
      WHERE story_id = ${storyId} AND session_id = ${sessionId}
      GROUP BY action
    )
    SELECT
      EXISTS (SELECT 1 FROM actions WHERE action = 'like' AND last_at > COALESCE((SELECT last_at FROM actions WHERE action = 'unlike'), '1970-01-01'::timestamptz)) AS liked,
      EXISTS (SELECT 1 FROM actions WHERE action = 'dislike' AND last_at > COALESCE((SELECT last_at FROM actions WHERE action = 'undislike'), '1970-01-01'::timestamptz)) AS disliked,
      EXISTS (SELECT 1 FROM actions WHERE action = 'share') AS shared,
      EXISTS (SELECT 1 FROM actions WHERE action = 'report') AS reported
  `)) as unknown as Array<{ liked: boolean; disliked: boolean; shared: boolean; reported: boolean }>;
  return rows[0] ?? { liked: false, disliked: false, shared: false, reported: false };
}

// ─── Brigade detection ─────────────────────────────────────────────────────
//
// If 5+ likes or dislikes arrive within 10 minutes from sessions created
// in the last 30 minutes, flag the story. The flag is visible to admins
// but never auto-hides the story. Real community signal looks bursty too;
// the admin has to look at the pattern.

const BRIGADE_MIN_COUNT = 5;
const BRIGADE_WINDOW_MIN = 10;
const BRIGADE_SESSION_AGE_MIN = 30;

async function checkBrigade(storyId: number): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT action, COUNT(*)::int AS n
    FROM story_signals ss
    JOIN reader_sessions rs ON rs.id = ss.session_id
    WHERE ss.story_id = ${storyId}
      AND ss.action IN ('like','dislike')
      AND ss.created_at > NOW() - INTERVAL '${sql.raw(String(BRIGADE_WINDOW_MIN))} minutes'
      AND rs.created_at > NOW() - INTERVAL '${sql.raw(String(BRIGADE_SESSION_AGE_MIN))} minutes'
    GROUP BY action
  `)) as unknown as { action: string; n: number }[];
  for (const r of rows) {
    if (r.n >= BRIGADE_MIN_COUNT) {
      const reason = `${r.n} ${r.action}s from sessions <${BRIGADE_SESSION_AGE_MIN}min old within ${BRIGADE_WINDOW_MIN}min`;
      await db.execute(sql`
        UPDATE signal_aggregates
        SET brigade_flag = true, brigade_reason = ${reason}, updated_at = NOW()
        WHERE story_id = ${storyId}
      `);
      return;
    }
  }
}

// ─── Bulk aggregates for feed responses ─────────────────────────────────

export interface AggregateSnapshot {
  storyId: number;
  views: number;
  likes: number;
  dislikes: number;
  shares: number;
  reports: number;
  brigadeFlag: boolean;
}

/**
 * Returns aggregates for a list of story ids. Missing ids return zero
 * counts (no signal_aggregates row yet).
 */
export async function aggregatesForStories(storyIds: number[]): Promise<Map<number, AggregateSnapshot>> {
  if (storyIds.length === 0) return new Map();
  const validIds = storyIds.filter((n) => Number.isFinite(n));
  if (validIds.length === 0) return new Map();
  const rows = (await db.execute(
    sql.raw(`
      SELECT story_id, view_count, like_count, dislike_count, share_count,
             report_count, brigade_flag
      FROM signal_aggregates
      WHERE story_id IN (${validIds.join(",")})
    `),
  )) as unknown as Array<{
    story_id: number; view_count: number; like_count: number;
    dislike_count: number; share_count: number; report_count: number;
    brigade_flag: boolean;
  }>;
  const map = new Map<number, AggregateSnapshot>();
  for (const r of rows) {
    map.set(r.story_id, {
      storyId: r.story_id,
      views: r.view_count, likes: r.like_count, dislikes: r.dislike_count,
      shares: r.share_count, reports: r.report_count, brigadeFlag: r.brigade_flag,
    });
  }
  return map;
}

/**
 * For a single session, returns which stories they've liked / disliked /
 * reported, so the public UI can render the right button state.
 */
export async function userStatesForStories(
  sessionId: string,
  storyIds: number[],
): Promise<Map<number, { liked: boolean; disliked: boolean; shared: boolean; reported: boolean }>> {
  const map = new Map<number, { liked: boolean; disliked: boolean; shared: boolean; reported: boolean }>();
  if (storyIds.length === 0) return map;
  const validIds = storyIds.filter((n) => Number.isFinite(n));
  if (validIds.length === 0) return map;
  const rows = (await db.execute(
    sql.raw(`
      SELECT story_id,
        BOOL_OR(action = 'like' AND created_at > COALESCE(
          (SELECT MAX(created_at) FROM story_signals s2
           WHERE s2.story_id = ss.story_id AND s2.session_id = ss.session_id
             AND s2.action = 'unlike'), '1970-01-01'::timestamptz)) AS liked,
        BOOL_OR(action = 'dislike' AND created_at > COALESCE(
          (SELECT MAX(created_at) FROM story_signals s2
           WHERE s2.story_id = ss.story_id AND s2.session_id = ss.session_id
             AND s2.action = 'undislike'), '1970-01-01'::timestamptz)) AS disliked,
        BOOL_OR(action = 'share') AS shared,
        BOOL_OR(action = 'report') AS reported
      FROM story_signals ss
      WHERE story_id IN (${validIds.join(",")})
        AND session_id = '${sessionId.replace(/'/g, "")}'
      GROUP BY story_id
    `),
  )) as unknown as Array<{
    story_id: number; liked: boolean; disliked: boolean; shared: boolean; reported: boolean;
  }>;
  for (const r of rows) {
    map.set(r.story_id, {
      liked: !!r.liked, disliked: !!r.disliked,
      shared: !!r.shared, reported: !!r.reported,
    });
  }
  return map;
}
