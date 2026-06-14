/**
 * Phase 25: cockpit endpoints \u2014 the new admin home.
 *
 * Two endpoints power the new /admin page:
 *   - GET /api/admin/cockpit/summary - the "needs you now" banner counts
 *   - GET /api/admin/cockpit/feed    - the main feed with signal joins
 *
 * Both are admin-gated by the caller (server/routes.ts wires requireAdmin).
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../storage.js";
import {
  sendAdminMessage, listConversation,
  listDrafts, approveDraft,
} from "../learning/conversation-service.js";

interface AttentionRow {
  reports: number;
  brigade: number;
  audits_open: number;
  audits_high: number;
  drafts: number;
  fresh_24h: number;
}

/** Resolve the cityId for a slug param. Returns null when slug is 'all'/missing/bad. */
async function cityIdForSlug(slug: string | null): Promise<number | null> {
  if (!slug || slug === "all") return null;
  const rows = (await db.execute(
    sql`SELECT id FROM cities WHERE slug = ${slug} LIMIT 1`,
  )) as unknown as { id: number }[];
  return rows[0]?.id ?? null;
}

export function registerCockpitRoutes(app: Express, requireAdmin: any) {
  // ----- Phase 26: per-story chat with the AI -----
  //
  // GET  /api/admin/stories/:id/conversation - load thread history
  // POST /api/admin/stories/:id/chat         - admin sends a message,
  //   gets back the AI's reply, the extracted signals, and notes about
  //   which signals applied immediately (desk reroute, source-trust bump).
  app.get("/api/admin/stories/:id/conversation", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    try {
      const turns = await listConversation(id);
      res.json({ turns });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.post("/api/admin/stories/:id/chat", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const message = String(req.body?.message ?? "").trim();
    if (!message) return res.status(400).json({ error: "message required" });
    if (message.length > 4000) return res.status(400).json({ error: "message too long" });
    const citySlug = req.body?.citySlug ? String(req.body.citySlug) : null;
    const adminId = (req as any).adminId ?? null;
    try {
      const result = await sendAdminMessage({
        storyId: id, message, adminId, citySlug,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // ----- Phase 27: draft revisions -----
  // GET /api/admin/stories/:id/drafts                 - list all draft versions
  // POST /api/admin/stories/:id/drafts/:version/approve - approve a version
  app.get("/api/admin/stories/:id/drafts", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    try {
      const drafts = await listDrafts(id);
      res.json({ drafts });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.post("/api/admin/stories/:id/drafts/:version/approve", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const version = Number(req.params.version);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    if (!Number.isFinite(version) || version <= 0) return res.status(400).json({ error: "invalid version" });
    try {
      const approved = await approveDraft(id, version);
      res.json({ approved });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // ----- Phase 28: Remove + Trash + Restore -----
  // Remove a story: requires reason; flips mod_state to 'trashed' and logs
  // an entry on story_removals so we never lose the why.
  app.post("/api/admin/stories/:id/remove", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 8) {
      return res.status(400).json({ error: "reason must be at least 8 characters" });
    }
    if (reason.length > 4000) {
      return res.status(400).json({ error: "reason too long" });
    }
    const removedBy = (req as any).adminId ?? null;
    try {
      // Capture current state for restore.
      const prev = (await db.execute(sql`
        SELECT mod_state FROM stories WHERE id = ${id} LIMIT 1
      `)) as unknown as { mod_state: string }[];
      if (!prev[0]) return res.status(404).json({ error: "story not found" });
      const prevState = prev[0].mod_state;
      await db.execute(sql`
        UPDATE stories SET mod_state = 'trashed' WHERE id = ${id}
      `);
      const inserted = (await db.execute(sql`
        INSERT INTO story_removals (story_id, reason, removed_by, prev_mod_state)
        VALUES (${id}, ${reason}, ${removedBy}, ${prevState})
        RETURNING id, story_id, reason, removed_by, removed_at, prev_mod_state
      `)) as unknown as any[];
      res.json({ ok: true, removal: inserted[0] });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // Restore a trashed story to its prior mod_state.
  app.post("/api/admin/stories/:id/restore", requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const restoredBy = (req as any).adminId ?? null;
    try {
      // Find the latest active (non-restored) removal record.
      const active = (await db.execute(sql`
        SELECT id, prev_mod_state FROM story_removals
        WHERE story_id = ${id} AND restored_at IS NULL
        ORDER BY removed_at DESC LIMIT 1
      `)) as unknown as { id: number; prev_mod_state: string | null }[];
      const prev = active[0]?.prev_mod_state ?? "New";
      await db.execute(sql`
        UPDATE stories SET mod_state = ${prev} WHERE id = ${id}
      `);
      if (active[0]) {
        await db.execute(sql`
          UPDATE story_removals
          SET restored_at = NOW(), restored_by = ${restoredBy}
          WHERE id = ${active[0].id}
        `);
      }
      res.json({ ok: true, restoredTo: prev });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // Trash bin: every active removal joined to its story.
  app.get("/api/admin/trash", requireAdmin, async (req: any, res: any) => {
    const cityId = await cityIdForSlug(req.query.city ? String(req.query.city) : null);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const cityClause = cityId ? sql`AND s.city_id = ${cityId}` : sql``;
    try {
      const rows = (await db.execute(sql`
        SELECT
          r.id              AS removal_id,
          r.reason,
          r.removed_by,
          r.removed_at,
          r.prev_mod_state,
          s.id              AS story_id,
          s.headline,
          s.summary,
          s.desk,
          s.source_name,
          s.source_url,
          s.city_id,
          s.published_at
        FROM story_removals r
        JOIN stories s ON s.id = r.story_id
        WHERE r.restored_at IS NULL
          AND s.mod_state = 'trashed'
          ${cityClause}
        ORDER BY r.removed_at DESC
        LIMIT ${limit}
      `)) as unknown as any[];
      res.json({ items: rows });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // GET /api/admin/cockpit/summary
  // One round-trip for the banner counts. Optionally city-scoped.
  app.get("/api/admin/cockpit/summary", requireAdmin, async (req: any, res: any) => {
    const cityId = await cityIdForSlug(req.query.city ? String(req.query.city) : null);
    const cityFilter = cityId ? `AND s.city_id = ${cityId}` : "";

    const rows = (await db.execute(
      sql.raw(`
        SELECT
          (SELECT COUNT(*)::int FROM signal_aggregates sa
            JOIN stories s ON s.id = sa.story_id
            WHERE sa.report_count > 0 AND s.mod_state NOT IN ('rejected','trashed') ${cityFilter}) AS reports,
          (SELECT COUNT(*)::int FROM signal_aggregates sa
            JOIN stories s ON s.id = sa.story_id
            WHERE sa.brigade_flag = true AND s.mod_state NOT IN ('rejected','trashed') ${cityFilter}) AS brigade,
          (SELECT COUNT(*)::int FROM editorial_audits
            WHERE status = 'open' AND severity IN ('high','medium')) AS audits_open,
          (SELECT COUNT(*)::int FROM editorial_audits
            WHERE status = 'open' AND severity = 'high') AS audits_high,
          (SELECT COUNT(*)::int FROM stories s
            WHERE s.mod_state = 'draft' ${cityFilter}) AS drafts,
          (SELECT COUNT(*)::int FROM stories s
            WHERE s.mod_state NOT IN ('rejected','trashed')
              AND s.published_at >= (NOW() - INTERVAL '24 hours')::text
              ${cityFilter}) AS fresh_24h
      `),
    )) as unknown as AttentionRow[];
    res.json(
      rows[0] ?? {
        reports: 0, brigade: 0, audits_open: 0,
        audits_high: 0, drafts: 0, fresh_24h: 0,
      },
    );
  });

  // GET /api/admin/cockpit/feed
  // The main feed. Returns story + signals + audit flag in one row.
  app.get("/api/admin/cockpit/feed", requireAdmin, async (req: any, res: any) => {
    const cityId = await cityIdForSlug(req.query.city ? String(req.query.city) : null);
    const sort = String(req.query.sort ?? "attention");          // attention | newest | most_disliked
    const filter = String(req.query.filter ?? "all");             // all | reports | brigade | drafts | audits | fresh24h
    const desk = req.query.desk ? String(req.query.desk) : null;
    const searchRaw = req.query.search ? String(req.query.search).trim() : "";
    const search = searchRaw.replace(/'/g, "''");
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const conds: string[] = ["s.mod_state NOT IN ('rejected','trashed')"];
    if (cityId) conds.push(`s.city_id = ${cityId}`);
    if (desk) conds.push(`s.desk = '${desk.replace(/'/g, "")}'`);
    if (search) {
      conds.push(`(s.headline ILIKE '%${search}%' OR s.source_name ILIKE '%${search}%')`);
    }
    if (filter === "reports") conds.push("COALESCE(sa.report_count, 0) > 0");
    if (filter === "brigade") conds.push("COALESCE(sa.brigade_flag, false) = true");
    if (filter === "drafts") conds.push("s.mod_state = 'draft'");
    if (filter === "audits") {
      conds.push(
        "EXISTS (SELECT 1 FROM editorial_audits ea WHERE ea.status = 'open' AND s.id = ANY(ea.subject_story_ids))",
      );
    }
    if (filter === "fresh24h") conds.push("s.published_at >= (NOW() - INTERVAL '24 hours')::text");

    let orderBy: string;
    if (sort === "newest") {
      orderBy = "s.published_at DESC";
    } else if (sort === "most_disliked") {
      orderBy = "COALESCE(sa.dislike_count, 0) DESC, s.published_at DESC";
    } else {
      // attention_score heuristic. Not a relevance signal \u2014 only sorts
      // this admin view. Per editorial discussion June 14:
      //   reports * 100 dominates;
      //   brigade adds 50;
      //   an open audit adds 30;
      //   a draft adds 20;
      //   dislikes contribute up to 10 (capped to keep them as a tie-breaker,
      //   not a primary driver \u2014 we explicitly do not act on dislikes alone).
      orderBy = `(
        COALESCE(sa.report_count, 0) * 100
        + (CASE WHEN COALESCE(sa.brigade_flag, false) THEN 50 ELSE 0 END)
        + (CASE WHEN EXISTS (
            SELECT 1 FROM editorial_audits ea
            WHERE ea.status = 'open' AND s.id = ANY(ea.subject_story_ids)
          ) THEN 30 ELSE 0 END)
        + (CASE WHEN s.mod_state = 'draft' THEN 20 ELSE 0 END)
        + LEAST(COALESCE(sa.dislike_count, 0), 10)
      ) DESC, s.published_at DESC`;
    }

    const rows = (await db.execute(
      sql.raw(`
        SELECT
          s.id, s.headline, s.summary, s.desk, s.source_name, s.source_url,
          s.source_type, s.published_at, s.city_id, s.mod_state, s.on_calendar,
          s.starts_at, s.ends_at, s.location, s.is_obituary, s.is_synthesis,
          s.is_people_profile, s.is_sports_recap, s.tags,
          COALESCE(sa.view_count, 0)    AS view_count,
          COALESCE(sa.like_count, 0)    AS like_count,
          COALESCE(sa.dislike_count, 0) AS dislike_count,
          COALESCE(sa.share_count, 0)   AS share_count,
          COALESCE(sa.report_count, 0)  AS report_count,
          COALESCE(sa.brigade_flag, false) AS brigade_flag,
          sa.brigade_reason,
          EXISTS (
            SELECT 1 FROM editorial_audits ea
            WHERE ea.status = 'open' AND s.id = ANY(ea.subject_story_ids)
          ) AS has_open_audit
        FROM stories s
        LEFT JOIN signal_aggregates sa ON sa.story_id = s.id
        WHERE ${conds.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `),
    )) as unknown as any[];
    res.json({ items: rows, limit, offset });
  });
}
