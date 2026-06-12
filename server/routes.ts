import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage.js";
import { z } from "zod";
import { ingestAll, ingestSource } from "./ingest/ingester.js";
import { rssFetcher } from "./ingest/rss.js";
import { htmlFetcher } from "./ingest/html.js";
import { headlessFetcher } from "./ingest/headless.js";
import type { Source } from "../shared/schema.js";
import { DESKS, SOURCE_CATEGORIES, FEED_TYPES, SOURCE_TYPES } from "../shared/schema.js";
import { issueToken, revokeToken, requireAdmin, verifyPassword } from "./auth.js";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ----- City resolver -----
  // Every public endpoint accepts ?city=<slug>. Default = Missoula.
  // We cache the slug → id map for the lambda's lifetime since cities change rarely.
  let citySlugToId: Map<string, number> | null = null;
  async function resolveCityId(slug: string | undefined | null): Promise<number | undefined> {
    if (!slug) return undefined;
    if (!citySlugToId) {
      const all = await storage.listCities();
      citySlugToId = new Map(all.map((c) => [c.slug, c.id]));
    }
    return citySlugToId.get(slug) ?? undefined;
  }

  // List of all cities (for the public dropdown)
  app.get("/api/cities", async (_req, res) => {
    const cs = await storage.listCities();
    res.json(cs.map((c) => ({
      id: c.id,
      slug: c.slug,
      displayName: c.displayName,
      state: c.state,
      lat: c.lat,
      lon: c.lon,
      countyName: c.countyName,
      nwsZone: c.nwsZone,
    })));
  });

  // ----- Stories feed -----
  app.get("/api/stories", async (req, res) => {
    const schema = z.object({
      desk: z.string().optional(),
      // Multi-desk filter — comma-separated list of desk IDs.
      // Server returns stories whose desk matches ANY of the listed values.
      // Single-desk `desk` param is kept for back-compat and used when this is omitted.
      desks: z.string().optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      cursor: z.coerce.number().int().min(0).optional(),
      modState: z.enum(["all", "draft", "approved", "rejected"]).optional(),
      isReviewed: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
      includeEvents: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
      city: z.string().optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const cityId = await resolveCityId(parsed.data.city);
    const desksArr = parsed.data.desks
      ? parsed.data.desks.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    // Apply the per-desk rebalance for the public feed: only on page 1 and
    // only when the user is browsing "All" (no desk filter / no search).
    // The storage layer guards against rebalancing in any other case so the
    // admin Inbox stays in strict chronological order.
    const noDeskFilter = !(desksArr && desksArr.length > 0)
      && (!parsed.data.desk || parsed.data.desk === "all");
    const noSearch = !parsed.data.q || !parsed.data.q.trim();
    const noCursor = !parsed.data.cursor || parsed.data.cursor === 0;
    const isPublicModState = !parsed.data.modState || parsed.data.modState === "approved";
    const rebalance = noDeskFilter && noSearch && noCursor && isPublicModState;
    const result = await storage.listStories({
      ...parsed.data,
      desks: desksArr,
      cityId,
      rebalance,
    });
    // Annotate each story with its source count so feed cards can show "+N sources".
    const items = await Promise.all(
      result.items.map(async (s) => ({ ...s, sourceCount: await storage.countStorySources(s.id) })),
    );
    res.json({ ...result, items });
  });

  app.get("/api/stories/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const story = await storage.getStory(id);
    if (!story) return res.status(404).json({ error: "Not found" });
    const sources = await storage.listStorySources(id);
    res.json({ ...story, sources });
  });

  app.patch("/api/stories/:id/mod", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const schema = z.object({ modState: z.enum(["draft", "approved", "rejected"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const before = await storage.getStory(id);
    if (!before) return res.status(404).json({ error: "Not found" });
    const updated = await storage.updateStoryModState(id, parsed.data.modState);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (before.modState !== parsed.data.modState) {
      await storage.logEdit({
        storyId: id,
        field: "modState",
        beforeValue: before.modState,
        afterValue: parsed.data.modState,
        sourceName: before.sourceName,
        editedAt: new Date().toISOString(),
      });
      try {
        const delta = parsed.data.modState === "approved" ? 2 : parsed.data.modState === "rejected" ? -3 : 0;
        if (delta !== 0) {
          const src = (await storage.listSources()).find((s) => s.name === before.sourceName);
          if (src) await storage.bumpSourceTrust(src.id, delta);
        }
      } catch {}
    }
    res.json(updated);
  });

  // ----- Admin auth -----
  app.post("/api/admin/login", async (req, res) => {
    const schema = z.object({ password: z.string().min(1).max(200) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });
    if (!verifyPassword(parsed.data.password)) {
      // Small artificial delay to slow brute force a hair.
      return setTimeout(() => res.status(401).json({ error: "Wrong password" }), 500);
    }
    const { token, expiresAt } = await issueToken();
    res.json({ token, expiresAt });
  });

  app.post("/api/admin/logout", async (req, res) => {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+([A-Za-z0-9]+)$/);
    if (m) await revokeToken(m[1]);
    res.json({ ok: true });
  });

  app.get("/api/admin/ping", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  // ----- Admin: edit / delete stories -----
  // Full point-and-click editor schema for the cockpit's StoryEditDialog.
  // Every field is optional so the client can PATCH any subset of fields.
  const editStorySchema = z.object({
    headline: z.string().min(2).max(400).optional(),
    summary: z.string().min(2).max(20000).optional(),
    desk: z.enum(DESKS).optional(),
    sourceUrl: z.string().url().max(800).optional(),
    sourceName: z.string().min(1).max(200).optional(),
    onCalendar: z.boolean().optional(),
    venue: z.string().max(200).nullable().optional(),
    startsAt: z.string().max(40).nullable().optional(),
    endsAt: z.string().max(40).nullable().optional(),
    // Extended fields wired by the cockpit:
    modState: z.enum(["draft", "approved", "rejected"]).optional(),
    cityId: z.number().int().positive().optional(),
    publishedAt: z.string().min(8).max(40).optional(),
    tags: z.string().max(1000).optional(),
    location: z.string().max(200).nullable().optional(),
    isReviewed: z.boolean().optional(),
  });

  // ----- Admin: mark story as reviewed (admin sign-off / training signal) -----
  app.patch("/api/admin/stories/:id/review", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const schema = z.object({ isReviewed: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const before = await storage.getStory(id);
    if (!before) return res.status(404).json({ error: "Not found" });
    const updated = await storage.markStoryReviewed(id, parsed.data.isReviewed);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (before.isReviewed !== parsed.data.isReviewed) {
      await storage.logEdit({
        storyId: id,
        field: "isReviewed",
        beforeValue: String(before.isReviewed),
        afterValue: String(parsed.data.isReviewed),
        sourceName: before.sourceName,
        editedAt: new Date().toISOString(),
      });
      // Approving = positive signal: bump source trust.
      if (parsed.data.isReviewed) {
        try {
          const src = (await storage.listSources()).find((s) => s.name === before.sourceName);
          if (src) await storage.bumpSourceTrust(src.id, 3);
        } catch {}
      }
    }
    res.json(updated);
  });

  app.patch("/api/admin/stories/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = editStorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const before = await storage.getStory(id);
    if (!before) return res.status(404).json({ error: "Not found" });

    // Calendar binary rule: if onCalendar is being set to true (or already true
    // and starts_at is being cleared), require a starts_at value.
    const nextOnCalendar = parsed.data.onCalendar ?? before.onCalendar;
    const nextStartsAt =
      parsed.data.startsAt !== undefined ? parsed.data.startsAt : before.startsAt;
    if (nextOnCalendar && !nextStartsAt) {
      return res.status(400).json({
        error:
          "To show this on the community calendar, you must also set a start date and time. Either fill in 'Starts at' or turn off 'Show on calendar'.",
      });
    }
    // Convenience: turning off the calendar flag clears the event-only fields.
    if (parsed.data.onCalendar === false) {
      if (parsed.data.venue === undefined) parsed.data.venue = null;
      if (parsed.data.startsAt === undefined) parsed.data.startsAt = null;
      if (parsed.data.endsAt === undefined) parsed.data.endsAt = null;
    }

    const updated = await storage.updateStoryFields(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    const editedAt = new Date().toISOString();
    for (const key of [
      "headline", "summary", "desk", "sourceUrl", "sourceName",
      "onCalendar", "venue", "startsAt", "endsAt",
      // Extended fields from the cockpit editor:
      "modState", "cityId", "publishedAt", "tags", "location", "isReviewed",
    ] as const) {
      const beforeVal = (before as any)[key] ?? null;
      const afterVal = (parsed.data as any)[key];
      if (afterVal !== undefined && afterVal !== beforeVal) {
        await storage.logEdit({
          storyId: id,
          field: key,
          beforeValue: beforeVal == null ? null : String(beforeVal),
          afterValue: afterVal == null ? null : String(afterVal),
          sourceName: before.sourceName,
          editedAt,
        });
      }
    }
    res.json(updated);
  });

  app.delete("/api/admin/stories/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const before = await storage.getStory(id);
    if (!before) return res.status(404).json({ error: "Not found" });
    const ok = await storage.deleteStory(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    await storage.logEdit({
      storyId: id,
      field: "deleted",
      beforeValue: before.headline,
      afterValue: null,
      sourceName: before.sourceName,
      editedAt: new Date().toISOString(),
    });
    try {
      const src = (await storage.listSources()).find((s) => s.name === before.sourceName);
      if (src) await storage.bumpSourceTrust(src.id, -4);
    } catch {}
    res.json({ ok: true });
  });

  // ----- Classification rules CRUD -----
  app.get("/api/admin/rules", requireAdmin, async (_req, res) => {
    res.json({ rules: await storage.listClassificationRules() });
  });
  const ruleInputSchema = z.object({
    matchField: z.enum(["headline", "summary", "text", "source"]),
    pattern: z.string().min(1).max(400),
    action: z.enum(["set_desk", "reject", "set_kind"]),
    value: z.string().max(60),
    priority: z.number().int().min(0).max(1000).optional(),
    notes: z.string().max(400).optional().nullable(),
    active: z.boolean().optional(),
  });
  app.post("/api/admin/rules", requireAdmin, async (req, res) => {
    const parsed = ruleInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const created = await storage.createClassificationRule({
      matchField: parsed.data.matchField, pattern: parsed.data.pattern, action: parsed.data.action,
      value: parsed.data.value, priority: parsed.data.priority ?? 0, notes: parsed.data.notes ?? null,
      active: parsed.data.active ?? true, createdAt: new Date().toISOString(), createdBy: "admin",
    } as any);
    const { invalidateRuleCache } = await import("./ingest/rules.js");
    invalidateRuleCache();
    res.json(created);
  });
  app.patch("/api/admin/rules/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = ruleInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateClassificationRule(id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    const { invalidateRuleCache } = await import("./ingest/rules.js");
    invalidateRuleCache();
    res.json(updated);
  });
  app.delete("/api/admin/rules/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = await storage.deleteClassificationRule(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    const { invalidateRuleCache } = await import("./ingest/rules.js");
    invalidateRuleCache();
    res.json({ ok: true });
  });

  // ===== Phase 6: Editorial cockpit (feed presets) =====
  //
  // Saved composite-feed recipes that admins use to triage. Each preset
  // bundles a city scope, desk multi-select, mod state, query, time window,
  // sort, and display options into a single named filter that can be
  // one-click applied. The storage layer (listStoriesByPreset /
  // createFeedPreset etc.) is in server/storage.ts; this section exposes
  // it over HTTP and gates everything behind requireAdmin.

  // Lazy import to avoid a circular type ref at load time.
  const { feedPresetConfigSchema: _fpc, insertFeedPresetSchema: _fpi } =
    await import("../shared/schema.js");
  const feedPresetConfigSchema = _fpc;
  const insertFeedPresetSchema = _fpi;

  // GET /api/admin/presets
  // Lists presets visible to the current admin: their own personal presets
  // PLUS any shared/org presets, optionally scoped by city.
  app.get("/api/admin/presets", requireAdmin, async (req, res) => {
    const ownerId = (req as any).adminId as string | undefined;
    const cityId = req.query.cityId ? Number(req.query.cityId) : undefined;
    const includeInactive = req.query.includeInactive === "true";
    const presets = await storage.listFeedPresets({
      ownerId,
      cityId: Number.isFinite(cityId) ? (cityId as number) : undefined,
      includeInactive,
    });
    res.json({ presets });
  });

  // POST /api/admin/presets/preview
  // Live preview of a composite query WITHOUT saving. Used by the cockpit
  // editor to render the right-pane story list as the admin tweaks filters.
  app.post("/api/admin/presets/preview", requireAdmin, async (req, res) => {
    const previewSchema = z.object({
      config: feedPresetConfigSchema,
      cityId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      queryOverride: z.string().max(200).optional(),
    });
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid preview request", details: parsed.error.flatten() });
    }
    const result = await storage.listStoriesByPreset(parsed.data.config, {
      cityId: parsed.data.cityId,
      limit: parsed.data.limit ?? 50,
      queryOverride: parsed.data.queryOverride,
    });
    res.json(result);
  });

  // POST /api/admin/presets
  // Save a new preset. Server stamps ownerId from the admin session so an
  // admin can never create a personal preset for someone else.
  app.post("/api/admin/presets", requireAdmin, async (req, res) => {
    const ownerId = ((req as any).adminId as string | undefined) ?? null;
    const input = {
      ...(req.body ?? {}),
      ownerId: req.body?.scope === "personal" ? ownerId : (req.body?.ownerId ?? null),
      slug:
        (req.body?.slug ?? req.body?.name ?? "")
          .toString()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || `preset-${Date.now()}`,
    };
    const parsed = insertFeedPresetSchema.safeParse(input);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid preset", details: parsed.error.flatten() });
    }
    try {
      const preset = await storage.createFeedPreset(parsed.data as any);
      await storage.recordFeedPresetEvent({
        presetId: preset.id,
        adminId: ownerId,
        cityId: preset.cityId ?? null,
        action: "save",
        config: preset.config,
      });
      res.status(201).json({ preset });
    } catch (err: any) {
      if (err?.code === "23505") {
        return res
          .status(409)
          .json({ error: "A preset with that name or slug already exists." });
      }
      throw err;
    }
  });

  // PATCH /api/admin/presets/:id
  // Partial update. Server bumps config_version automatically when the
  // config payload changes (see storage.updateFeedPreset).
  app.patch("/api/admin/presets/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const patchSchema = z.object({
      name: z.string().min(1).max(200).optional(),
      slug: z.string().min(1).max(80).optional(),
      scope: z.enum(["personal", "shared", "org"]).optional(),
      config: feedPresetConfigSchema.optional(),
      cityId: z.number().int().positive().nullable().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid patch", details: parsed.error.flatten() });
    }
    const updated = await storage.updateFeedPreset(id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    const ownerId = ((req as any).adminId as string | undefined) ?? null;
    await storage.recordFeedPresetEvent({
      presetId: updated.id,
      adminId: ownerId,
      cityId: updated.cityId ?? null,
      action: "update",
      config: updated.config,
    });
    res.json({ preset: updated });
  });

  // POST /api/admin/presets/:id/apply
  // Telemetry-only. The actual filter is applied client-side by reading
  // the preset's config. This endpoint records that the admin clicked
  // Apply so the suggestion engine can learn from real usage patterns.
  app.post("/api/admin/presets/:id/apply", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const preset = await storage.getFeedPreset(id);
    if (!preset) return res.status(404).json({ error: "Not found" });
    const ownerId = ((req as any).adminId as string | undefined) ?? null;
    const ev = await storage.recordFeedPresetEvent({
      presetId: preset.id,
      adminId: ownerId,
      cityId: preset.cityId ?? null,
      action: "apply",
      config: preset.config,
    });
    res.json({ ok: true, event: ev });
  });

  // DELETE /api/admin/presets/:id (soft delete; flips is_active=false)
  app.delete("/api/admin/presets/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const preset = await storage.getFeedPreset(id);
    if (!preset) return res.status(404).json({ error: "Not found" });
    const ok = await storage.softDeleteFeedPreset(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    const ownerId = ((req as any).adminId as string | undefined) ?? null;
    await storage.recordFeedPresetEvent({
      presetId: id,
      adminId: ownerId,
      cityId: preset.cityId ?? null,
      action: "delete",
      config: preset.config,
    });
    res.json({ ok: true });
  });

  // GET /api/admin/preset-signatures
  // Top filter signatures across the org over the last N days. Used by the
  // cockpit's "Suggested presets" sidebar so admins can adopt patterns
  // that other admins have converged on.
  app.get("/api/admin/preset-signatures", requireAdmin, async (req, res) => {
    const days = Math.min(Number(req.query.days ?? 14), 365);
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    res.json({
      signatures: await storage.topFilterSignatures({ sinceDays: days, limit }),
    });
  });

  // ===== Phase 7: user feedback (public submit + cockpit triage) =====
  //
  // Public users post via /api/feedback (no auth, rate-limited per IP).
  // Cockpit admins read + triage via /api/admin/feedback* with requireAdmin.

  const { submitFeedbackSchema } = await import("../shared/schema.js");

  // ---- Simple in-memory rate limit. 5 submissions per IP per 10 minutes.
  // Resets on cold start, which is fine for a small site -- this isn't an
  // anti-abuse layer, just a flood guard. Real spam handling lives in the
  // /admin/feedback triage UI (admin can mark archived or delete).
  const feedbackRateBucket = new Map<string, { count: number; resetAt: number }>();
  function clientKey(req: any): string {
    const fwd = (req.headers["x-forwarded-for"] as string | undefined) || "";
    const ip = fwd.split(",")[0]?.trim() || req.ip || "unknown";
    return ip;
  }

  app.post("/api/feedback", async (req, res) => {
    const parsed = submitFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Please fill in the feedback message.", details: parsed.error.flatten() });
    }
    // Rate limit
    const key = clientKey(req);
    const now = Date.now();
    const bucket = feedbackRateBucket.get(key);
    if (bucket && bucket.resetAt > now) {
      if (bucket.count >= 5) {
        return res.status(429).json({
          error: "Thanks for the enthusiasm. Please wait a few minutes before sending more.",
        });
      }
      bucket.count++;
    } else {
      feedbackRateBucket.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    }

    const ua = (req.headers["user-agent"] as string | undefined)?.slice(0, 500) ?? null;
    // Empty-string optional fields collapse to null so the DB stays clean.
    const norm = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
    const row = await storage.createFeedback({
      body: parsed.data.body.trim(),
      name: norm(parsed.data.name),
      email: norm(parsed.data.email),
      citySlug: norm(parsed.data.citySlug),
      pageUrl: norm(parsed.data.pageUrl),
      userAgent: ua,
    } as any);
    res.status(201).json({ ok: true, id: row.id });
  });

  // List all feedback for the cockpit. Optional filters.
  app.get("/api/admin/feedback", requireAdmin, async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "open";
    const citySlug = (req.query.citySlug as string | undefined) || undefined;
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const items = await storage.listFeedback({
      status: (["open", "in_progress", "resolved", "archived", "all"].includes(status)
        ? (status as any)
        : "open"),
      citySlug,
      limit,
    });
    const openCount = await storage.countOpenFeedback();
    res.json({ items, openCount });
  });

  // Patch status / admin note.
  app.patch("/api/admin/feedback/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const patchSchema = z.object({
      status: z.enum(["open", "in_progress", "resolved", "archived"]).optional(),
      adminNote: z.string().max(4000).optional().nullable(),
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateFeedback(id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Edit log + patterns (for the "learning from manual edits" panel)
  app.get("/api/admin/edits", requireAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json({
      edits: await storage.listEdits(limit),
      patterns: await storage.recentEditPatterns(7),
    });
  });

  // Suggested classification rules from repeated manual desk reassignments.
  // Shown on /admin Rules tab as 'Suggested rule: route X stories from Y → Z'.
  app.get("/api/admin/suggested-rules", requireAdmin, async (req, res) => {
    const minCount = Math.min(Number(req.query.minCount ?? 5), 50);
    const days = Math.min(Number(req.query.days ?? 30), 365);
    res.json({ suggestions: await storage.suggestedRules(minCount, days) });
  });

  // ----- Admin: add / delete sources + test before saving -----
  const newSourceSchema = z.object({
    name: z.string().min(2).max(120),
    url: z.string().url().max(800),
    feedUrl: z.string().url().max(800).optional().or(z.literal("")),
    feedType: z.enum(FEED_TYPES),
    parserKey: z.string().max(120).optional().or(z.literal("")),
    sourceType: z.enum(SOURCE_TYPES),
    desks: z.array(z.enum(DESKS)).min(1),
    cadenceMinutes: z.coerce.number().int().min(5).max(720).default(15),
    category: z.enum(SOURCE_CATEGORIES),
    city: z.string().optional(),
  });

  app.post("/api/admin/sources", requireAdmin, async (req, res) => {
    const parsed = newSourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const cityId = (await resolveCityId(d.city)) ?? 1; // default to Missoula
    const created = await storage.createSource({
      name: d.name,
      url: d.url,
      feedUrl: d.feedUrl && d.feedUrl.length > 0 ? d.feedUrl : null,
      feedType: d.feedType,
      parserKey: d.parserKey && d.parserKey.length > 0 ? d.parserKey : null,
      sourceType: d.sourceType,
      desks: JSON.stringify(d.desks),
      cadenceMinutes: d.cadenceMinutes,
      category: d.category,
      active: true,
      lastStatus: "idle",
      lastItems: 0,
      handle: null,
      platform: null,
      lastCheckedAt: null,
      lastMode: null,
      lastError: null,
      cityId,
    } as any);
    res.json(created);
  });

  app.delete("/api/admin/sources/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = await storage.deleteSource(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // Edit a source in place. Any subset of fields may be patched.
  const patchSourceSchema = z.object({
    name: z.string().min(2).max(120).optional(),
    url: z.string().url().max(800).optional(),
    feedUrl: z.string().url().max(800).nullable().optional(),
    feedType: z.enum(FEED_TYPES).optional(),
    parserKey: z.string().max(120).nullable().optional(),
    sourceType: z.enum(SOURCE_TYPES).optional(),
    desks: z.array(z.enum(DESKS)).optional(),
    cadenceMinutes: z.number().int().min(1).max(60 * 24 * 7).optional(),
    active: z.boolean().optional(),
    category: z.enum(SOURCE_CATEGORIES).optional(),
    handle: z.string().max(80).nullable().optional(),
    platform: z.string().max(40).nullable().optional(),
    trustScore: z.number().int().min(0).max(100).optional(),
  });
  app.patch("/api/admin/sources/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = patchSourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateSource(id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    await storage.logEdit({
      storyId: 0, field: "source",
      beforeValue: String(id), afterValue: JSON.stringify(parsed.data),
      sourceName: updated.name, editedAt: new Date().toISOString(),
    });
    res.json(updated);
  });

  // Dry-run a source: fetch + parse, return what we'd ingest, DO NOT persist.
  // Accepts either an existing sourceId or an inline source spec (for the
  // "Test before adding" form).
  const testSourceSchema = z.object({
    sourceId: z.coerce.number().int().optional(),
    name: z.string().optional(),
    url: z.string().url().optional(),
    feedUrl: z.string().url().optional(),
    feedType: z.enum(FEED_TYPES).optional(),
    parserKey: z.string().optional(),
    sourceType: z.enum(SOURCE_TYPES).optional(),
    desks: z.array(z.enum(DESKS)).optional(),
    category: z.enum(SOURCE_CATEGORIES).optional(),
  });

  app.post("/api/admin/sources/test", requireAdmin, async (req, res) => {
    const parsed = testSourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    let source: Source | undefined;
    if (parsed.data.sourceId) {
      source = await storage.getSource(parsed.data.sourceId);
      if (!source) return res.status(404).json({ error: "Source not found" });
    } else {
      const d = parsed.data;
      if (!d.name || !d.url || !d.feedType || !d.sourceType || !d.desks || !d.category) {
        return res.status(400).json({ error: "Missing required fields for inline test" });
      }
      source = {
        id: -1,
        name: d.name,
        url: d.url,
        feedUrl: d.feedUrl ?? null,
        feedType: d.feedType,
        parserKey: d.parserKey ?? null,
        sourceType: d.sourceType,
        desks: JSON.stringify(d.desks),
        categoryPriority: null,
        cadenceMinutes: 15,
        lastCheckedAt: null,
        lastStatus: "idle",
        lastMode: null,
        lastError: null,
        lastItems: 0,
        active: true,
        category: d.category,
        handle: null,
        platform: null,
        trustScore: 50,
      } as Source;
    }
    try {
      let result;
      if (source.feedType === "rss" || source.feedType === "atom") {
        result = await rssFetcher.fetch(source);
      } else if (source.feedType === "html") {
        result = await htmlFetcher.fetch(source);
      } else if (source.feedType === "headless") {
        result = await headlessFetcher.fetch(source);
      } else {
        result = { mode: "mock" as const, items: [], error: "no feed configured" };
      }
      // Trim items to first 8 for preview, strip nothing.
      const preview = result.items.slice(0, 8).map((it) => ({
        title: it.title,
        url: it.url,
        summary: it.summary?.slice(0, 240) ?? null,
        publishedAt: it.publishedAt ?? null,
      }));
      res.json({
        mode: result.mode,
        error: result.error ?? null,
        totalItems: result.items.length,
        preview,
      });
    } catch (err: any) {
      res.status(200).json({
        mode: "mock",
        error: String(err?.message ?? err),
        totalItems: 0,
        preview: [],
      });
    }
  });

  // ----- Events, sources, aggregates for right rail -----
  app.get("/api/events", async (req, res) => {
    const schema = z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      city: z.string().optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const cityId = await resolveCityId(parsed.data.city);
    res.json(await storage.listEvents(parsed.data.limit ?? 8, cityId));
  });

  app.get("/api/sources", async (req, res) => {
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    const sources = await storage.listSources(cityId);
    const counts = await storage.getPublishedCounts(cityId);
    const enriched = sources.map((s) => ({
      ...s,
      publishedCount: counts.get(s.name.toLowerCase()) ?? 0,
    }));
    res.json(enriched);
  });

  app.get("/api/trending-tags", async (req, res) => {
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    res.json(await storage.getTrendingTags(10, cityId));
  });

  app.get("/api/top-stories", async (req, res) => {
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    res.json(await storage.getTopStories(6, cityId));
  });

  // ----- Ingestion pipeline -----
  // Manual run-all (admin "Refresh all sources")
  app.post("/api/ingest/run", requireAdmin, async (_req, res) => {
    const summaries = await ingestAll();
    res.json({ summaries });
  });

  // Manual run for a single source (admin "Run now")
  app.post("/api/ingest/run/:sourceId", requireAdmin, async (req, res) => {
    const id = Number(req.params.sourceId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid sourceId" });
    const source = await storage.getSource(id);
    if (!source) return res.status(404).json({ error: "Source not found" });
    const summary = await ingestSource(source);
    res.json({ summary });
  });

  // Ingest run log (admin panel)
  app.get("/api/ingest/runs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 40), 100);
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    res.json(await storage.listIngestRuns(limit, cityId));
  });

  // ----- Weather (public NWS API, no key) -----
  // Cached server-side for 10 minutes per city.
  const weatherCache = new Map<string, { fetchedAt: number; payload: any }>();
  app.get("/api/weather", async (req, res) => {
    try {
      const citySlug = typeof req.query.city === "string" ? req.query.city : "missoula";
      const cityId = await resolveCityId(citySlug);
      const city = cityId ? await storage.getCityById(cityId) : await storage.getCityBySlug("missoula");
      const lat = city?.lat ?? 46.8721;
      const lon = city?.lon ?? -113.9940;
      const cacheKey = `${lat},${lon}`;
      const now = Date.now();
      const cached = weatherCache.get(cacheKey);
      // 3-minute server-side cache. Short enough that newly-issued NWS
      // alerts surface quickly across lambda instances; long enough to
      // protect NWS from being hammered by every page view.
      if (cached && now - cached.fetchedAt < 3 * 60 * 1000) {
        return res.json(cached.payload);
      }
      const headers = { "User-Agent": "ZooTown/1.0 (Montana civic aggregator)", Accept: "application/geo+json" };
      const points = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers }).then(r => r.json()).catch(() => null);
      const observationStationsUrl = points?.properties?.observationStations;
      const forecastUrl = points?.properties?.forecast;
      const alertsZone = points?.properties?.county; // county zone for alerts
      let temperatureF: number | null = null;
      let conditionText: string | null = null;
      let icon: string | null = null;
      let humidity: number | null = null;
      let windText: string | null = null;
      let high: number | null = null;
      let low: number | null = null;
      let alerts: Array<{ event: string; severity: string }> = [];
      if (observationStationsUrl) {
        // NWS stations frequently report null temperature on their "latest"
        // observation, especially small rural stations. Walk through the
        // first few stations until we find one with a real reading.
        const stations = await fetch(observationStationsUrl, { headers }).then(r => r.json()).catch(() => null);
        const features: any[] = stations?.features ?? [];
        for (const f of features.slice(0, 6)) {
          const stId = f?.properties?.stationIdentifier;
          if (!stId) continue;
          const obs = await fetch(`https://api.weather.gov/stations/${stId}/observations/latest`, { headers }).then(r => r.json()).catch(() => null);
          const p = obs?.properties;
          if (!p) continue;
          const tempC = p.temperature?.value;
          if (typeof tempC !== "number") continue; // try next station
          temperatureF = Math.round(tempC * 9 / 5 + 32);
          conditionText = p.textDescription ?? null;
          icon = p.icon ?? null;
          humidity = typeof p.relativeHumidity?.value === "number" ? Math.round(p.relativeHumidity.value) : null;
          const windKmh = p.windSpeed?.value;
          if (typeof windKmh === "number") {
            const mph = Math.round(windKmh * 0.621371);
            windText = mph > 0 ? `${mph} mph` : "calm";
          }
          break; // got it
        }
      }
      if (forecastUrl) {
        const forecast = await fetch(forecastUrl, { headers }).then(r => r.json()).catch(() => null);
        const periods = forecast?.properties?.periods ?? [];
        // Pull today's high (first daytime period) and tonight's low (first nighttime period)
        for (const p of periods) {
          if (p.isDaytime && high == null) high = p.temperature;
          if (!p.isDaytime && low == null) low = p.temperature;
          if (high != null && low != null) break;
        }
        // Fallback: if no observation station gave us a current temp/condition,
        // use the first forecast period's values. Better than showing nothing.
        if (temperatureF == null && periods.length > 0) {
          const first = periods[0];
          if (typeof first.temperature === "number") temperatureF = first.temperature;
          if (typeof first.shortForecast === "string" && !conditionText) conditionText = first.shortForecast;
          if (typeof first.windSpeed === "string" && !windText) windText = first.windSpeed;
        }
      }
      // Active alerts — query NWS by point (most reliable; matches what a user
      // would see on weather.gov for that lat/lon). Fall back to the county
      // zone query if the point query fails. Dedupe identical events.
      let alertsFetchFailed = false;
      async function fetchAlerts(url: string) {
        try {
          const r = await fetch(url, { headers });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      }
      const pointUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
      let a = await fetchAlerts(pointUrl);
      if (a === null && alertsZone) {
        // Retry via county zone
        a = await fetchAlerts(`https://api.weather.gov/alerts/active?zone=${alertsZone.split("/").pop()}`);
      }
      if (a === null) {
        alertsFetchFailed = true;
      } else {
        const seen = new Set<string>();
        const features = (a?.features ?? []) as any[];
        for (const f of features) {
          const event = f.properties?.event ?? "Alert";
          const severity = f.properties?.severity ?? "Unknown";
          const headline = f.properties?.headline ?? "";
          const key = `${event}|${headline}`;
          if (seen.has(key)) continue;
          seen.add(key);
          alerts.push({ event, severity, headline });
        }
      }
      const locationLabel = city ? `${city.displayName}, ${city.state}` : "Missoula, MT";
      const forecastLink = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
      const payload = {
        location: locationLabel,
        temperatureF,
        conditionText,
        icon,
        humidity,
        windText,
        high,
        low,
        alerts,
        source: "National Weather Service",
        sourceUrl: forecastLink,
        fetchedAt: new Date().toISOString(),
      };
      // Only cache if the alerts fetch succeeded — we'd rather make NWS
      // do extra work than serve users "no alerts" for 10 minutes when
      // there actually are active alerts.
      if (!alertsFetchFailed) {
        weatherCache.set(cacheKey, { fetchedAt: now, payload });
      }
      res.json(payload);
    } catch (err: any) {
      res.status(200).json({
        location: "Montana",
        temperatureF: null,
        conditionText: "Unavailable",
        error: String(err?.message ?? err),
        source: "National Weather Service",
        sourceUrl: "https://forecast.weather.gov/",
        fetchedAt: new Date().toISOString(),
      });
    }
  });

  // ----- Jobs (community-posted, admin-moderated) -----
  // Anyone can submit a job; submissions are 'pending' until the admin
  // approves them via the admin panel. Approved jobs are stored forever.
  const jobPostSubmitSchema = z.object({
    title: z.string().trim().min(2).max(160),
    business: z.string().trim().min(2).max(160),
    address: z.string().trim().max(240).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    pay: z.string().trim().max(80).optional().or(z.literal("")),
    body: z.string().trim().min(10).max(8000),
    submitterEmail: z.string().trim().email().optional().or(z.literal("")),
  });

  app.get("/api/jobs", async (req, res) => {
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    const jobs = await storage.listJobPosts("approved", cityId);
    res.json({ jobs, fetchedAt: new Date().toISOString() });
  });

  app.post("/api/jobs", async (req, res) => {
    const parsed = jobPostSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const wordCount = parsed.data.body.split(/\s+/).filter(Boolean).length;
    if (wordCount > 1000) {
      return res.status(400).json({ error: { fieldErrors: { body: [`Please keep the description under 1000 words (you have ${wordCount}).`] } } });
    }
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : (typeof (req.body as any).city === "string" ? (req.body as any).city : undefined));
    const job = await storage.createJobPost({
      title: parsed.data.title,
      business: parsed.data.business,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      pay: parsed.data.pay || null,
      body: parsed.data.body,
      submitterEmail: parsed.data.submitterEmail || null,
      cityId: cityId ?? null,
    } as any);
    res.status(201).json({ ok: true, id: job.id });
  });

  // Admin endpoints for moderation
  app.get("/api/admin/jobs", requireAdmin, async (req, res) => {
    const state = (req.query.state as string | undefined) || undefined;
    if (state && state !== "pending" && state !== "approved" && state !== "rejected") {
      return res.status(400).json({ error: "invalid state" });
    }
    const jobs = await storage.listJobPosts(state as any);
    res.json({
      jobs,
      counts: {
        pending: await storage.countJobPosts("pending"),
        approved: await storage.countJobPosts("approved"),
        rejected: await storage.countJobPosts("rejected"),
      },
    });
  });

  app.patch("/api/admin/jobs/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const state = String(req.body?.state || "");
    if (state !== "pending" && state !== "approved" && state !== "rejected") {
      return res.status(400).json({ error: "invalid state" });
    }
    const updated = await storage.setJobPostState(id, state);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  app.delete("/api/admin/jobs/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const ok = await storage.deleteJobPost(id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  // ----- Live refresh signal -----
  // The front end polls this every 30s. It now reflects real ingestion activity
  // — the timestamp and count from the most recent ingest_runs row — rather than
  // the old "latest publishedAt" hack.
  app.get("/api/pulse", async (req, res) => {
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    const runs = await storage.listIngestRuns(12, cityId);
    const lastRun = runs[0];
    const totalAddedRecently = runs.reduce((n, r) => n + r.added, 0);
    const top = await storage.listStories({ desk: "all", limit: 1, modState: "approved", cityId });
    res.json({
      latestPublishedAt: top.items[0]?.publishedAt ?? null,
      total: top.total,
      lastIngestAt: lastRun?.finishedAt ?? null,
      lastIngestSource: lastRun?.sourceName ?? null,
      lastIngestAdded: lastRun?.added ?? 0,
      lastIngestMode: lastRun?.mode ?? null,
      recentAdded: totalAddedRecently,
      nextCheckInSeconds: 30,
      ingestionCadenceMinutes: 5,
      serverTime: new Date().toISOString(),
    });
  });


  // ----- History stories -----
  app.get("/api/history", async (req, res) => {
    const desk = typeof req.query.desk === "string" ? req.query.desk : null;
    const cityId = await resolveCityId(typeof req.query.city === "string" ? req.query.city : undefined);
    const all = await storage.listHistoryStories(cityId);
    if (!desk) return res.json(all);
    res.json(all.filter((h) => (h.desk ?? "history") === desk));
  });

  app.post("/api/admin/history", requireAdmin, async (req, res) => {
    const schema = z.object({
      headline: z.string().min(2).max(400),
      summary: z.string().min(10).max(20000),
      sourceUrl: z.string().url().max(800).optional().or(z.literal("")).optional(),
      desk: z.enum(["history", "people"]).optional(),
      kind: z.enum(["history", "profile", "obituary"]).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { addHistoryStory } = await import("./history.js");
    const story = await addHistoryStory(
      parsed.data.headline,
      parsed.data.summary,
      parsed.data.sourceUrl || undefined,
      parsed.data.desk ?? "history",
      parsed.data.kind ?? "history",
    );
    res.json(story);
  });

  // Admin: full pool listing (includes hidden rows), with desk filter.
  app.get("/api/admin/history", requireAdmin, async (req, res) => {
    const desk = typeof req.query.desk === "string" ? req.query.desk : "history";
    res.json(await storage.listAllHistoryStoriesForDesk(desk));
  });

  // Admin: edit one long-form article.
  const patchHistorySchema = z.object({
    headline: z.string().min(2).max(400).optional(),
    summary: z.string().min(10).max(50000).optional(),
    sourceUrl: z.string().url().max(800).nullable().optional(),
    desk: z.enum(["history", "people"]).optional(),
    kind: z.enum(["history", "profile", "obituary"]).optional(),
    isVisible: z.boolean().optional(),
  });
  app.patch("/api/admin/history/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = patchHistorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateHistoryStory(id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    await storage.logEdit({
      storyId: 0, field: "history",
      beforeValue: String(id), afterValue: JSON.stringify(parsed.data),
      sourceName: "ZooTown", editedAt: new Date().toISOString(),
    });
    res.json(updated);
  });

  // Admin: delete a long-form article.
  app.delete("/api/admin/history/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    await storage.deleteHistoryStoryById(id);
    await storage.logEdit({
      storyId: 0, field: "history_deleted",
      beforeValue: String(id), afterValue: null,
      sourceName: "ZooTown", editedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  });

  return httpServer;
}
