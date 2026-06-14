/**
 * Phase 28 safety net: training-data export.
 *
 * GET /api/admin/export/training
 *
 * Returns a single JSON blob with every table that holds editorial training
 * data, so we can ship it to Dropbox on a weekly cadence and never lose the
 * trail through a deploy or a botched migration.
 *
 * Auth: Bearer token matching CRON_SECRET. We don't reuse the admin token
 * because scheduled tasks need to call this unattended and admin tokens are
 * short-lived.
 *
 * Optional ?since=ISO8601 filters tables that have a timestamp column to
 * just the recent slice. Without ?since, returns everything (suitable for
 * a full snapshot once a week).
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../storage.js";

export function registerExportRoutes(app: Express) {
  app.get("/api/admin/export/training", async (req: any, res: any) => {
    const auth = req.headers.authorization || "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    if (!process.env.CRON_SECRET || auth !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const since = typeof req.query.since === "string" ? req.query.since : null;
    const sinceClause = since
      ? sql` WHERE created_at >= ${since}`
      : sql``;

    try {
      const conversations = (await db.execute(sql`
        SELECT id, story_id, role, message, extracted_signals, admin_id, city_slug, created_at
        FROM story_conversations
        ${sinceClause}
        ORDER BY created_at ASC
      `)) as unknown as any[];

      const signals = (await db.execute(sql`
        SELECT id, conversation_id, story_id, kind, subject, target, value, confidence,
               applied, applied_at, application_note, created_at
        FROM learned_signals
        ${sinceClause}
        ORDER BY created_at ASC
      `)) as unknown as any[];

      const drafts = (await db.execute(sql`
        SELECT id, story_id, version, headline, summary, why_it_matters, desk, tags,
               source_of_change, conversation_turn_id, status, created_at, approved_at
        FROM story_drafts
        ${sinceClause}
        ORDER BY created_at ASC
      `)) as unknown as any[];

      const removals = (await db.execute(sql`
        SELECT id, story_id, reason, removed_by, removed_at, restored_at,
               restored_by, prev_mod_state
        FROM story_removals
        ${since ? sql` WHERE removed_at >= ${since}` : sql``}
        ORDER BY removed_at ASC
      `)) as unknown as any[];

      const edits = (await db.execute(sql`
        SELECT id, story_id, field, before_value, after_value, source_name, edited_at
        FROM story_edits
        ${since ? sql` WHERE edited_at >= ${since}` : sql``}
        ORDER BY edited_at ASC
      `)) as unknown as any[];

      const audits = (await db.execute(sql`
        SELECT id, kind, severity, status, fingerprint, summary, evidence,
               subject_story_ids, opened_at, resolved_at, resolution_note
        FROM editorial_audits
        ${since ? sql` WHERE opened_at >= ${since}` : sql``}
        ORDER BY opened_at ASC
      `)) as unknown as any[];

      const signalAggregates = (await db.execute(sql`
        SELECT story_id, view_count, like_count, dislike_count, share_count,
               report_count, brigade_flag, brigade_reason, updated_at
        FROM signal_aggregates
      `)) as unknown as any[];

      const summary = {
        exported_at: new Date().toISOString(),
        since: since ?? null,
        counts: {
          story_conversations: conversations.length,
          learned_signals: signals.length,
          story_drafts: drafts.length,
          story_removals: removals.length,
          story_edits: edits.length,
          editorial_audits: audits.length,
          signal_aggregates: signalAggregates.length,
        },
      };

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...summary,
        story_conversations: conversations,
        learned_signals: signals,
        story_drafts: drafts,
        story_removals: removals,
        story_edits: edits,
        editorial_audits: audits,
        signal_aggregates: signalAggregates,
      });
    } catch (err: any) {
      console.error("[export/training] error:", err);
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });
}
