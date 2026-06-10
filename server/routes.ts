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
  // ----- Stories feed -----
  app.get("/api/stories", async (req, res) => {
    const schema = z.object({
      desk: z.string().optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      cursor: z.coerce.number().int().min(0).optional(),
      modState: z.enum(["all", "draft", "approved", "rejected"]).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await storage.listStories(parsed.data);
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
  app.post("/api/admin/login", (req, res) => {
    const schema = z.object({ password: z.string().min(1).max(200) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });
    if (!verifyPassword(parsed.data.password)) {
      // Small artificial delay to slow brute force a hair.
      return setTimeout(() => res.status(401).json({ error: "Wrong password" }), 500);
    }
    const { token, expiresAt } = issueToken();
    res.json({ token, expiresAt });
  });

  app.post("/api/admin/logout", (req, res) => {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+([A-Za-z0-9]+)$/);
    if (m) revokeToken(m[1]);
    res.json({ ok: true });
  });

  app.get("/api/admin/ping", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  // ----- Admin: edit / delete stories -----
  const editStorySchema = z.object({
    headline: z.string().min(2).max(400).optional(),
    summary: z.string().min(2).max(2000).optional(),
    desk: z.string().max(60).optional(),
    sourceUrl: z.string().url().max(800).optional(),
  });

  app.patch("/api/admin/stories/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = editStorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const before = await storage.getStory(id);
    if (!before) return res.status(404).json({ error: "Not found" });
    const updated = await storage.updateStoryFields(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    const editedAt = new Date().toISOString();
    for (const key of ["headline", "summary", "desk", "sourceUrl"] as const) {
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

  // Edit log + patterns (for the "learning from manual edits" panel)
  app.get("/api/admin/edits", requireAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json({
      edits: await storage.listEdits(limit),
      patterns: await storage.recentEditPatterns(7),
    });
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
  });

  app.post("/api/admin/sources", requireAdmin, async (req, res) => {
    const parsed = newSourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
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
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(await storage.listEvents(parsed.data.limit ?? 8));
  });

  app.get("/api/sources", async (_req, res) => {
    const sources = await storage.listSources();
    const counts = await storage.getPublishedCounts();
    const enriched = sources.map((s) => ({
      ...s,
      publishedCount: counts.get(s.name.toLowerCase()) ?? 0,
    }));
    res.json(enriched);
  });

  app.get("/api/trending-tags", async (_req, res) => {
    res.json(await storage.getTrendingTags(10));
  });

  app.get("/api/top-stories", async (_req, res) => {
    res.json(await storage.getTopStories(6));
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
    res.json(await storage.listIngestRuns(limit));
  });

  // ----- Weather (public NWS API, no key) -----
  // Cached server-side for 10 minutes so we don't hammer api.weather.gov.
  let weatherCache: { fetchedAt: number; payload: any } | null = null;
  app.get("/api/weather", async (_req, res) => {
    try {
      const now = Date.now();
      if (weatherCache && now - weatherCache.fetchedAt < 10 * 60 * 1000) {
        return res.json(weatherCache.payload);
      }
      const headers = { "User-Agent": "ZooTown/1.0 (missoula civic aggregator)", Accept: "application/geo+json" };
      // Missoula, MT — use NWS station + grid endpoints. Lat/lon = 46.8721, -113.9940
      const points = await fetch("https://api.weather.gov/points/46.8721,-113.9940", { headers }).then(r => r.json()).catch(() => null);
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
        const stations = await fetch(observationStationsUrl, { headers }).then(r => r.json()).catch(() => null);
        const station = stations?.features?.[0]?.properties?.stationIdentifier;
        if (station) {
          const obs = await fetch(`https://api.weather.gov/stations/${station}/observations/latest`, { headers }).then(r => r.json()).catch(() => null);
          const p = obs?.properties;
          if (p) {
            const tempC = p.temperature?.value;
            if (typeof tempC === "number") temperatureF = Math.round(tempC * 9 / 5 + 32);
            conditionText = p.textDescription ?? null;
            icon = p.icon ?? null;
            humidity = typeof p.relativeHumidity?.value === "number" ? Math.round(p.relativeHumidity.value) : null;
            const windKmh = p.windSpeed?.value;
            if (typeof windKmh === "number") {
              const mph = Math.round(windKmh * 0.621371);
              windText = mph > 0 ? `${mph} mph` : "calm";
            }
          }
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
      }
      if (alertsZone) {
        const a = await fetch(`https://api.weather.gov/alerts/active?zone=${alertsZone.split("/").pop()}`, { headers }).then(r => r.json()).catch(() => null);
        alerts = (a?.features ?? []).map((f: any) => ({
          event: f.properties?.event ?? "Alert",
          severity: f.properties?.severity ?? "Unknown",
        }));
      }
      const payload = {
        location: "Missoula, MT",
        temperatureF,
        conditionText,
        icon,
        humidity,
        windText,
        high,
        low,
        alerts,
        source: "National Weather Service",
        sourceUrl: "https://forecast.weather.gov/MapClick.php?lat=46.8721&lon=-113.9940",
        fetchedAt: new Date().toISOString(),
      };
      weatherCache = { fetchedAt: now, payload };
      res.json(payload);
    } catch (err: any) {
      res.status(200).json({
        location: "Missoula, MT",
        temperatureF: null,
        conditionText: "Unavailable",
        error: String(err?.message ?? err),
        source: "National Weather Service",
        sourceUrl: "https://forecast.weather.gov/MapClick.php?lat=46.8721&lon=-113.9940",
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

  app.get("/api/jobs", async (_req, res) => {
    const jobs = await storage.listJobPosts("approved");
    res.json({ jobs, fetchedAt: new Date().toISOString() });
  });

  app.post("/api/jobs", async (req, res) => {
    const parsed = jobPostSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    // Soft word cap: ~1000 words
    const wordCount = parsed.data.body.split(/\s+/).filter(Boolean).length;
    if (wordCount > 1000) {
      return res.status(400).json({ error: { fieldErrors: { body: [`Please keep the description under 1000 words (you have ${wordCount}).`] } } });
    }
    const job = await storage.createJobPost({
      title: parsed.data.title,
      business: parsed.data.business,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      pay: parsed.data.pay || null,
      body: parsed.data.body,
      submitterEmail: parsed.data.submitterEmail || null,
    });
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
  app.get("/api/pulse", async (_req, res) => {
    const runs = await storage.listIngestRuns(12);
    const lastRun = runs[0];
    const totalAddedRecently = runs.reduce((n, r) => n + r.added, 0);
    const top = await storage.listStories({ desk: "all", limit: 1, modState: "approved" });
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
    const all = await storage.listHistoryStories();
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
