/**
 * Postgres-backed storage for ZooTown (Supabase).
 *
 * All methods are async. The schema lives in shared/schema.ts.
 * Tables are created via Supabase migrations (managed separately) — this
 * module does NOT create tables; it only reads/writes.
 */
import { stories, events, sources, ingestRuns, storySources, storyEdits, historyStories, classificationRules, meta, cities } from "../shared/schema.js";
import type {
  Story,
  InsertStory,
  EventItem,
  InsertEvent,
  Source,
  InsertSource,
  ModState,
  IngestRun,
  StorySource,
  StoryEdit,
  HistoryStory,
  InsertHistoryStory,
  JobPost,
  InsertJobPost,
  JobPostState,
  ClassificationRule,
  City,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, asc, and, gte, or, isNull, sql, inArray, ne } from "drizzle-orm";
import { jobPosts } from "../shared/schema.js";

// ------ Connection ------
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
if (!DATABASE_URL) {
  console.warn("[storage] DATABASE_URL not set — storage calls will fail until it is configured");
}

// postgres-js connection. Supabase pooler accepts up to 60 connections on free tier;
// we keep `max` low because serverless runs each instance briefly.
export const queryClient = postgres(DATABASE_URL || "postgres://invalid", {
  max: 5,
  prepare: false, // Supabase pooler doesn't support named prepared statements
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: "require", // Supabase requires SSL
});

export const db = drizzle(queryClient);

// ------ Query types ------
export interface StoryQuery {
  // Single desk string. Use "all" or omit for unrestricted. Kept for back-compat.
  desk?: string;
  // Multi-desk filter. When supplied, takes precedence over `desk` and returns
  // any story whose desk is in this list. Empty array == "all".
  desks?: string[];
  q?: string;
  limit?: number;
  cursor?: number;
  modState?: "all" | "draft" | "approved" | "rejected";
  isReviewed?: boolean;          // filter by admin-review state
  includeEvents?: boolean;       // legacy flag kept for compat; events live as desk-tagged stories now
  cityId?: number;               // multi-city: scope to this city. Omitted = Missoula default.
}

// ------ Row mappers (snake_case DB rows → camelCase types) ------
function rowToStory(r: any): Story {
  return {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    whyItMatters: r.why_it_matters ?? r.whyItMatters ?? null,
    desk: r.desk,
    tags: r.tags,
    sourceName: r.source_name ?? r.sourceName,
    sourceUrl: r.source_url ?? r.sourceUrl,
    sourceType: r.source_type ?? r.sourceType,
    publishedAt: r.published_at ?? r.publishedAt,
    fetchedAt: r.fetched_at ?? r.fetchedAt,
    location: r.location ?? null,
    status: r.status ?? null,
    riskLevel: r.risk_level ?? r.riskLevel,
    isSeeded: r.is_seeded === true || r.is_seeded === 1 || r.isSeeded === true,
    modState: r.mod_state ?? r.modState,
    politicalScope: r.political_scope ?? r.politicalScope ?? null,
    eventDate: r.event_date ?? r.eventDate ?? null,
    onCalendar: r.on_calendar === true || r.on_calendar === 1 || r.onCalendar === true,
    venue: r.venue ?? null,
    startsAt: r.starts_at ?? r.startsAt ?? null,
    endsAt: r.ends_at ?? r.endsAt ?? null,
    isReviewed: r.is_reviewed === true || r.is_reviewed === 1 || r.isReviewed === true,
    reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToEventFromStory(r: any): EventItem {
  // Convert a stories row to the EventItem shape used by the calendar.
  // Note: cityId is included so the calendar can filter / display per-city.
  return _rowToEventFromStory(r);
}
function _rowToEventFromStory(r: any): EventItem {
  return {
    id: r.id,
    title: r.headline,
    venue: r.venue ?? r.sourceName ?? "",
    startsAt: r.startsAt ?? r.eventDate ?? r.publishedAt,
    endsAt: r.endsAt ?? null,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    tag: "Event",
    desk: r.desk,
    description: r.summary ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}
function rowToEvent(r: any): EventItem {
  return {
    id: r.id,
    title: r.title,
    venue: r.venue,
    startsAt: r.starts_at ?? r.startsAt,
    endsAt: r.ends_at ?? r.endsAt ?? null,
    sourceName: r.source_name ?? r.sourceName,
    sourceUrl: r.source_url ?? r.sourceUrl,
    tag: r.tag ?? null,
    desk: r.desk ?? null,
    description: r.description ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToSource(r: any): Source {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    feedUrl: r.feed_url ?? r.feedUrl ?? null,
    feedType: r.feed_type ?? r.feedType,
    parserKey: r.parser_key ?? r.parserKey ?? null,
    sourceType: r.source_type ?? r.sourceType,
    desks: r.desks,
    categoryPriority: r.category_priority ?? r.categoryPriority ?? null,
    cadenceMinutes: r.cadence_minutes ?? r.cadenceMinutes,
    lastCheckedAt: r.last_checked_at ?? r.lastCheckedAt ?? null,
    lastStatus: r.last_status ?? r.lastStatus,
    lastMode: r.last_mode ?? r.lastMode ?? null,
    lastError: r.last_error ?? r.lastError ?? null,
    lastItems: r.last_items ?? r.lastItems,
    active: r.active === true || r.active === 1,
    category: r.category,
    handle: r.handle ?? null,
    platform: r.platform ?? null,
    trustScore: r.trust_score ?? r.trustScore ?? 50,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToIngestRun(r: any): IngestRun {
  return {
    id: r.id,
    sourceId: r.source_id ?? r.sourceId,
    sourceName: r.source_name ?? r.sourceName,
    startedAt: r.started_at ?? r.startedAt,
    finishedAt: r.finished_at ?? r.finishedAt,
    mode: r.mode,
    fetched: r.fetched,
    added: r.added,
    duplicates: r.duplicates,
    clustered: r.clustered,
    errors: r.errors,
    message: r.message ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToStorySource(r: any): StorySource {
  return {
    id: r.id,
    storyId: r.story_id ?? r.storyId,
    sourceName: r.source_name ?? r.sourceName,
    sourceUrl: r.source_url ?? r.sourceUrl,
    sourceType: r.source_type ?? r.sourceType,
    addedAt: r.added_at ?? r.addedAt,
  };
}

function rowToStoryEdit(r: any): StoryEdit {
  return {
    id: r.id,
    storyId: r.story_id ?? r.storyId,
    field: r.field,
    beforeValue: r.before_value ?? r.beforeValue ?? null,
    afterValue: r.after_value ?? r.afterValue ?? null,
    sourceName: r.source_name ?? r.sourceName ?? null,
    editedAt: r.edited_at ?? r.editedAt,
  };
}

function rowToHistoryStory(r: any): HistoryStory {
  return {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    sourceUrl: r.source_url ?? r.sourceUrl ?? null,
    desk: r.desk ?? "history",
    kind: r.kind ?? "history",
    publishedAt: r.published_at ?? r.publishedAt,
    lastBumpedAt: r.last_bumped_at ?? r.lastBumpedAt,
    isVisible: r.is_visible === true || r.is_visible === 1 || r.isVisible === true || r.is_visible == null,
    lastShownAt: r.last_shown_at ?? r.lastShownAt ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToRule(r: any): ClassificationRule {
  return {
    id: r.id,
    matchField: r.match_field ?? r.matchField,
    pattern: r.pattern,
    action: r.action,
    value: r.value,
    priority: r.priority ?? 0,
    notes: r.notes ?? null,
    createdAt: r.created_at ?? r.createdAt,
    createdBy: r.created_by ?? r.createdBy ?? "admin",
    hitCount: r.hit_count ?? r.hitCount ?? 0,
    active: r.active === true || r.active === 1,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

function rowToJobPost(r: any): JobPost {
  return {
    id: r.id,
    title: r.title,
    business: r.business,
    address: r.address ?? null,
    phone: r.phone ?? null,
    pay: r.pay ?? null,
    body: r.body,
    submitterEmail: r.submitter_email ?? r.submitterEmail ?? null,
    state: r.state,
    submittedAt: r.submitted_at ?? r.submittedAt,
    approvedAt: r.approved_at ?? r.approvedAt ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
  };
}

// ------ Title clustering helpers (used by ingester) ------
function tokenize(s: string): Set<string> {
  const stop = new Set([
    "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "at", "by", "with", "from",
    "is", "are", "as", "it", "this", "that", "be", "was", "were", "will", "new", "update",
    "missoula", "mt", "montana",
  ]);
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stop.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ------ Storage interface ------
export interface IStorage {
  // Multi-city helpers
  listCities(): Promise<City[]>;
  getCityBySlug(slug: string): Promise<City | undefined>;
  getCityById(id: number): Promise<City | undefined>;

  listStories(q: StoryQuery): Promise<{ items: Story[]; nextCursor: number | null; total: number }>;
  getStory(id: number): Promise<Story | undefined>;
  createStory(input: InsertStory): Promise<Story>;
  updateStoryModState(id: number, modState: ModState): Promise<Story | undefined>;
  listEvents(limit?: number, cityId?: number): Promise<EventItem[]>;
  findEventByUrl(url: string): Promise<EventItem | undefined>;
  createEvent(input: InsertEvent): Promise<EventItem>;
  listSources(cityId?: number): Promise<Source[]>;
  getPublishedCounts(cityId?: number): Promise<Map<string, number>>;
  getSource(id: number): Promise<Source | undefined>;
  updateSourceHealth(id: number, fields: { lastCheckedAt: string; lastStatus: string; lastMode: string | null; lastError: string | null; lastItems: number }): Promise<void>;
  findStoryByCanonicalUrl(canonicalUrl: string): Promise<Story | undefined>;
  findClusterCandidate(title: string, withinMs: number): Promise<Story | undefined>;
  attachStorySource(storyId: number, input: { sourceName: string; sourceUrl: string; sourceType: string }): Promise<StorySource>;
  listStorySources(storyId: number): Promise<StorySource[]>;
  countStorySources(storyId: number): Promise<number>;
  recordIngestRun(run: Omit<IngestRun, "id">): Promise<IngestRun>;
  listIngestRuns(limit?: number, cityId?: number): Promise<IngestRun[]>;
  getTrendingTags(limit?: number, cityId?: number): Promise<Array<{ tag: string; count: number }>>;
  getTopStories(limit?: number, cityId?: number): Promise<Story[]>;
  updateStoryFields(id: number, fields: Partial<Pick<Story, "headline" | "summary" | "desk" | "sourceUrl" | "sourceName" | "venue" | "startsAt" | "endsAt" | "onCalendar">>): Promise<Story | undefined>;
  markStoryReviewed(id: number, reviewed: boolean): Promise<Story | undefined>;
  deleteStory(id: number): Promise<boolean>;
  logEdit(edit: Omit<StoryEdit, "id">): Promise<StoryEdit>;
  listEdits(limit?: number): Promise<StoryEdit[]>;
  recentEditPatterns(days?: number): Promise<Array<{ sourceName: string; field: string; count: number }>>;
  // Suggest classification rules from repeated desk reassignments.
  suggestedRules(minCount?: number, days?: number): Promise<Array<{ sourceName: string; fromDesk: string; toDesk: string; count: number; sampleHeadlines: string[] }>>;
  createSource(input: InsertSource): Promise<Source>;
  deleteSource(id: number): Promise<boolean>;
  updateSource(id: number, patch: Partial<InsertSource>): Promise<Source | null>;
  bumpSourceTrust(id: number, delta: number): Promise<void>;
  updateSourceCategoryPriority(id: number, categoryPriority: string[]): Promise<void>;
  listClassificationRules(): Promise<ClassificationRule[]>;
  createClassificationRule(input: Omit<ClassificationRule, "id" | "hitCount">): Promise<ClassificationRule>;
  updateClassificationRule(id: number, patch: Partial<Omit<ClassificationRule, "id">>): Promise<ClassificationRule | null>;
  deleteClassificationRule(id: number): Promise<boolean>;
  incrementRuleHitCount(id: number): Promise<void>;
  listHistoryStories(cityId?: number): Promise<HistoryStory[]>;
  listAllHistoryStoriesForDesk(desk: string, cityId?: number): Promise<HistoryStory[]>;
  createHistoryStory(input: InsertHistoryStory): Promise<HistoryStory>;
  updateHistoryStory(id: number, patch: Partial<InsertHistoryStory>): Promise<HistoryStory | null>;
  setHistoryVisibility(ids: number[], visible: boolean): Promise<void>;
  markHistoryShownNow(ids: number[]): Promise<void>;
  bumpOldestHistoryStory(): Promise<void>;
  countHistoryStories(): Promise<number>;
  deleteHistoryStoryById(id: number): Promise<void>;
  listJobPosts(state?: JobPostState, cityId?: number): Promise<JobPost[]>;
  getJobPost(id: number): Promise<JobPost | null>;
  createJobPost(input: InsertJobPost): Promise<JobPost>;
  setJobPostState(id: number, state: JobPostState): Promise<JobPost | null>;
  deleteJobPost(id: number): Promise<boolean>;
  countJobPosts(state?: JobPostState): Promise<number>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

// ------ DatabaseStorage implementation ------
export class DatabaseStorage implements IStorage {
  // ----- Cities -----
  async listCities(): Promise<City[]> {
    const rows = await db.select().from(cities).where(eq(cities.active, true)).orderBy(asc(cities.sortOrder));
    return rows as City[];
  }
  async getCityBySlug(slug: string): Promise<City | undefined> {
    const rows = await db.select().from(cities).where(eq(cities.slug, slug)).limit(1);
    return rows[0] as City | undefined;
  }
  async getCityById(id: number): Promise<City | undefined> {
    const rows = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
    return rows[0] as City | undefined;
  }

  // ----- Stories -----
  async listStories(q: StoryQuery): Promise<{ items: Story[]; nextCursor: number | null; total: number }> {
    const limit = q.limit ?? 20;
    const cursor = q.cursor ?? 0;
    const modState = q.modState ?? "approved";
    const needle = q.q && q.q.trim() ? `%${q.q.trim().toLowerCase()}%` : null;

    // Build WHERE using SQL fragments. Use parameterized queries for safety.
    const conditions: any[] = [];
    if (modState !== "all") conditions.push(eq(stories.modState, modState));
    // Multi-desk OR single-desk filter. Multi takes precedence.
    if (q.desks && q.desks.length > 0) {
      conditions.push(inArray(stories.desk, q.desks));
    } else if (q.desk && q.desk !== "all") {
      conditions.push(eq(stories.desk, q.desk));
    }
    if (q.cityId) conditions.push(eq(stories.cityId, q.cityId));
    if (q.isReviewed !== undefined) conditions.push(eq(stories.isReviewed, q.isReviewed));
    if (needle) {
      conditions.push(sql`(lower(${stories.headline}) LIKE ${needle} OR lower(${stories.summary}) LIKE ${needle} OR lower(${stories.tags}) LIKE ${needle} OR lower(coalesce(${stories.location}, '')) LIKE ${needle})`);
    }
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const totalRes = await db.select({ c: sql<number>`count(*)::int` }).from(stories).where(whereClause as any);
    const total = totalRes[0]?.c ?? 0;

    const rows = await db
      .select()
      .from(stories)
      .where(whereClause as any)
      .orderBy(desc(stories.publishedAt))
      .limit(limit)
      .offset(cursor);

    const items = rows.map(rowToStory);
    const nextCursor = cursor + items.length < total ? cursor + items.length : null;
    return { items, nextCursor, total };
  }

  async getStory(id: number): Promise<Story | undefined> {
    const rows = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
    return rows[0] ? rowToStory(rows[0]) : undefined;
  }

  async createStory(input: InsertStory): Promise<Story> {
    const rows = await db.insert(stories).values(input).returning();
    return rowToStory(rows[0]);
  }

  async updateStoryModState(id: number, modState: ModState): Promise<Story | undefined> {
    await db.update(stories).set({ modState }).where(eq(stories.id, id));
    return this.getStory(id);
  }

  // ----- Events / Calendar -----
  // Anything in `stories` with a non-null starts_at counts as an "event" for the
  // community calendar. Desk is preserved so each row keeps its category color
  // (a city mayoral debate is desk='city', a Wilma show is desk='entertainment',
  // both appear on the calendar with their respective colors).
  async listEvents(limit = 6, cityId?: number): Promise<EventItem[]> {
    // A story belongs on the calendar iff on_calendar = true.
    const nowIso = new Date().toISOString();
    const conds: any[] = [
      eq(stories.onCalendar, true),
      ne(stories.modState, "rejected"),
      or(
        gte(stories.endsAt, nowIso),
        and(isNull(stories.endsAt), gte(stories.startsAt, nowIso)),
      ),
    ];
    if (cityId) conds.push(eq(stories.cityId, cityId));
    const rows = await db
      .select()
      .from(stories)
      .where(and(...conds))
      .orderBy(asc(stories.startsAt))
      .limit(limit);
    return rows.map(rowToEventFromStory);
  }

  async findEventByUrl(url: string): Promise<EventItem | undefined> {
    const rows = await db
      .select()
      .from(stories)
      .where(and(eq(stories.sourceUrl, url), eq(stories.onCalendar, true)))
      .limit(1);
    return rows[0] ? rowToEventFromStory(rows[0]) : undefined;
  }

  async createEvent(input: InsertEvent): Promise<EventItem> {
    // Insert as a story. Desk comes from the ingester (`entertainment` by default
    // for calendar-category sources, but the desk can be overridden per source).
    const now = new Date().toISOString();
    const targetDesk = input.desk && typeof input.desk === "string" ? input.desk : "entertainment";
    const storyRow = {
      headline: input.title,
      summary: input.description ?? input.title,
      desk: targetDesk,
      tags: "[]",
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      sourceType: "Community Calendar",
      publishedAt: now,
      fetchedAt: now,
      location: null,
      status: "Event",
      riskLevel: "low" as const,
      isSeeded: false,
      modState: "approved" as const,
      politicalScope: null,
      eventDate: input.startsAt,
      whyItMatters: null,
      onCalendar: true, // ingested from a calendar source = belongs on calendar
      venue: input.venue,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      isReviewed: false,
      reviewedAt: null,
      cityId: (input as any).cityId ?? null,
    };
    const rows = await db.insert(stories).values(storyRow).returning();
    return rowToEventFromStory(rows[0]);
  }

  // ----- Review workflow -----
  // Mark a story (or event) as admin-reviewed. Used by /api/admin/stories/:id/review.
  async markStoryReviewed(id: number, reviewed: boolean): Promise<Story | undefined> {
    const reviewedAt = reviewed ? new Date().toISOString() : null;
    await db.update(stories).set({ isReviewed: reviewed, reviewedAt }).where(eq(stories.id, id));
    return this.getStory(id);
  }

  // ----- Sources -----
  async listSources(cityId?: number): Promise<Source[]> {
    const q = cityId
      ? db.select().from(sources).where(eq(sources.cityId, cityId)).orderBy(asc(sources.name))
      : db.select().from(sources).orderBy(asc(sources.name));
    const rows = await q;
    return rows.map(rowToSource);
  }

  async getPublishedCounts(cityId?: number): Promise<Map<string, number>> {
    const rows = cityId
      ? await db.execute(sql`SELECT lower(source_name) AS name, COUNT(*)::int AS c FROM stories WHERE mod_state = 'approved' AND city_id = ${cityId} GROUP BY lower(source_name)`)
      : await db.execute(sql`SELECT lower(source_name) AS name, COUNT(*)::int AS c FROM stories WHERE mod_state = 'approved' GROUP BY lower(source_name)`);
    const map = new Map<string, number>();
    for (const r of rows as unknown as Array<{ name: string; c: number }>) map.set(r.name, r.c);
    return map;
  }

  async getSource(id: number): Promise<Source | undefined> {
    const rows = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
    return rows[0] ? rowToSource(rows[0]) : undefined;
  }

  async updateSourceHealth(
    id: number,
    fields: { lastCheckedAt: string; lastStatus: string; lastMode: string | null; lastError: string | null; lastItems: number },
  ): Promise<void> {
    await db.update(sources).set({
      lastCheckedAt: fields.lastCheckedAt,
      lastStatus: fields.lastStatus,
      lastMode: fields.lastMode,
      lastError: fields.lastError,
      lastItems: fields.lastItems,
    }).where(eq(sources.id, id));
  }

  async createSource(input: InsertSource): Promise<Source> {
    const rows = await db.insert(sources).values(input).returning();
    return rowToSource(rows[0]);
  }

  async deleteSource(id: number): Promise<boolean> {
    const res = await db.delete(sources).where(eq(sources.id, id)).returning({ id: sources.id });
    return res.length > 0;
  }

  async updateSourceCategoryPriority(id: number, categoryPriority: string[]): Promise<void> {
    await db.update(sources).set({ categoryPriority: JSON.stringify(categoryPriority) }).where(eq(sources.id, id));
  }

  async updateSource(id: number, patch: Partial<InsertSource>): Promise<Source | null> {
    const set: Record<string, any> = {};
    const keys: Array<keyof InsertSource> = [
      "name", "url", "feedUrl", "feedType", "parserKey", "sourceType", "desks",
      "categoryPriority", "cadenceMinutes", "active", "category", "handle", "platform", "trustScore",
    ];
    for (const k of keys) {
      if (k in patch) {
        let v: any = (patch as any)[k];
        if ((k === "desks" || k === "categoryPriority") && Array.isArray(v)) v = JSON.stringify(v);
        set[k] = v;
      }
    }
    if (Object.keys(set).length === 0) return (await this.getSource(id)) ?? null;
    const rows = await db.update(sources).set(set).where(eq(sources.id, id)).returning();
    return rows[0] ? rowToSource(rows[0]) : null;
  }

  async bumpSourceTrust(id: number, delta: number): Promise<void> {
    await db.execute(sql`UPDATE sources SET trust_score = GREATEST(0, LEAST(100, trust_score + ${delta})) WHERE id = ${id}`);
  }

  // ----- Clustering / dedupe -----
  async findStoryByCanonicalUrl(canonicalUrl: string): Promise<Story | undefined> {
    const direct = await db.select().from(stories).where(eq(stories.sourceUrl, canonicalUrl)).limit(1);
    if (direct[0]) return rowToStory(direct[0]);
    const via = await db.execute(sql`SELECT stories.* FROM story_sources JOIN stories ON stories.id = story_sources.story_id WHERE story_sources.source_url = ${canonicalUrl} LIMIT 1`);
    const r = (via as any)[0];
    return r ? rowToStory(r) : undefined;
  }

  async findClusterCandidate(title: string, withinMs: number): Promise<Story | undefined> {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const rows = await db
      .select()
      .from(stories)
      .where(and(eq(stories.modState, "approved"), gte(stories.publishedAt, cutoff)))
      .orderBy(desc(stories.publishedAt))
      .limit(120);
    const incoming = tokenize(title);
    if (incoming.size < 3) return undefined;
    let best: { row: any; score: number } | null = null;
    for (const r of rows) {
      const other = tokenize(r.headline);
      const score = jaccard(incoming, other);
      if (score >= 0.6 && (!best || score > best.score)) best = { row: r, score };
    }
    return best ? rowToStory(best.row) : undefined;
  }

  async attachStorySource(storyId: number, input: { sourceName: string; sourceUrl: string; sourceType: string }): Promise<StorySource> {
    const existing = await db.select().from(storySources).where(and(eq(storySources.storyId, storyId), eq(storySources.sourceUrl, input.sourceUrl))).limit(1);
    if (existing[0]) return rowToStorySource(existing[0]);
    const addedAt = new Date().toISOString();
    const rows = await db.insert(storySources).values({ storyId, sourceName: input.sourceName, sourceUrl: input.sourceUrl, sourceType: input.sourceType, addedAt }).returning();
    return rowToStorySource(rows[0]);
  }

  async listStorySources(storyId: number): Promise<StorySource[]> {
    const rows = await db.select().from(storySources).where(eq(storySources.storyId, storyId)).orderBy(asc(storySources.addedAt));
    return rows.map(rowToStorySource);
  }

  async countStorySources(storyId: number): Promise<number> {
    const res = await db.select({ c: sql<number>`count(*)::int` }).from(storySources).where(eq(storySources.storyId, storyId));
    return res[0]?.c ?? 0;
  }

  // ----- Ingest runs -----
  async recordIngestRun(run: Omit<IngestRun, "id">): Promise<IngestRun> {
    const rows = await db.insert(ingestRuns).values(run).returning();
    return rowToIngestRun(rows[0]);
  }

  async listIngestRuns(limit = 40, cityId?: number): Promise<IngestRun[]> {
    const q = cityId
      ? db.select().from(ingestRuns).where(eq(ingestRuns.cityId, cityId)).orderBy(desc(ingestRuns.startedAt)).limit(limit)
      : db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(limit);
    const rows = await q;
    return rows.map(rowToIngestRun);
  }

  // ----- Tags / top stories -----
  async getTrendingTags(limit = 10, cityId?: number): Promise<Array<{ tag: string; count: number }>> {
    const tagConds: any[] = [eq(stories.modState, "approved")];
    if (cityId) tagConds.push(eq(stories.cityId, cityId));
    const rows = await db
      .select({ tags: stories.tags })
      .from(stories)
      .where(and(...tagConds))
      .orderBy(desc(stories.publishedAt))
      .limit(80);
    const counts = new Map<string, number>();
    for (const r of rows) {
      try {
        const arr: string[] = JSON.parse(r.tags);
        for (const t of arr) counts.set(t, (counts.get(t) ?? 0) + 1);
      } catch {}
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getTopStories(limit = 6, cityId?: number): Promise<Story[]> {
    const windowStart = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const rows = cityId
      ? await db.execute(sql`
          SELECT * FROM stories
          WHERE mod_state = 'approved' AND published_at > ${windowStart} AND city_id = ${cityId}
          ORDER BY
            CASE risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
            published_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT * FROM stories
          WHERE mod_state = 'approved' AND published_at > ${windowStart}
          ORDER BY
            CASE risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
            published_at DESC
          LIMIT 200
        `);
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows as any[]) {
      const desk = r.desk as string | null;
      if (!desk || seen.has(desk)) continue;
      seen.add(desk);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out.map(rowToStory);
  }

  // ----- Story edit/delete + log -----
  async updateStoryFields(
    id: number,
    fields: Partial<Pick<Story, "headline" | "summary" | "desk" | "sourceUrl" | "sourceName" | "venue" | "startsAt" | "endsAt" | "onCalendar">>,
  ): Promise<Story | undefined> {
    const set: Record<string, any> = {};
    if (fields.headline !== undefined) set.headline = fields.headline;
    if (fields.summary !== undefined) set.summary = fields.summary;
    if (fields.desk !== undefined) set.desk = fields.desk;
    if (fields.sourceUrl !== undefined) set.sourceUrl = fields.sourceUrl;
    if (fields.sourceName !== undefined) set.sourceName = fields.sourceName;
    if (fields.venue !== undefined) set.venue = fields.venue;
    if (fields.startsAt !== undefined) set.startsAt = fields.startsAt;
    if (fields.endsAt !== undefined) set.endsAt = fields.endsAt;
    if (fields.onCalendar !== undefined) set.onCalendar = fields.onCalendar;
    if (Object.keys(set).length === 0) return this.getStory(id);
    await db.update(stories).set(set).where(eq(stories.id, id));
    return this.getStory(id);
  }

  async deleteStory(id: number): Promise<boolean> {
    await db.delete(storySources).where(eq(storySources.storyId, id));
    const res = await db.delete(stories).where(eq(stories.id, id)).returning({ id: stories.id });
    return res.length > 0;
  }

  async logEdit(edit: Omit<StoryEdit, "id">): Promise<StoryEdit> {
    const rows = await db.insert(storyEdits).values(edit).returning();
    return rowToStoryEdit(rows[0]);
  }

  async listEdits(limit = 100): Promise<StoryEdit[]> {
    const rows = await db.select().from(storyEdits).orderBy(desc(storyEdits.editedAt)).limit(limit);
    return rows.map(rowToStoryEdit);
  }

  async suggestedRules(minCount = 5, days = 30): Promise<Array<{ sourceName: string; fromDesk: string; toDesk: string; count: number; sampleHeadlines: string[] }>> {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    // Group desk-change edits by (sourceName, beforeValue, afterValue)
    const rows = await db.execute(sql`
      SELECT
        e.source_name,
        e.before_value AS from_desk,
        e.after_value  AS to_desk,
        COUNT(*)::int  AS c,
        (ARRAY_AGG(s.headline ORDER BY e.edited_at DESC))[1:3] AS sample_headlines
      FROM story_edits e
      LEFT JOIN stories s ON s.id = e.story_id
      WHERE e.field = 'desk'
        AND e.edited_at > ${cutoff}
        AND e.source_name IS NOT NULL
        AND e.before_value IS NOT NULL
        AND e.after_value IS NOT NULL
      GROUP BY e.source_name, e.before_value, e.after_value
      HAVING COUNT(*) >= ${minCount}
      ORDER BY c DESC
      LIMIT 20
    `);
    return (rows as any[]).map((r) => ({
      sourceName: r.source_name,
      fromDesk: r.from_desk,
      toDesk: r.to_desk,
      count: r.c,
      sampleHeadlines: Array.isArray(r.sample_headlines) ? r.sample_headlines.filter(Boolean) : [],
    }));
  }

  async recentEditPatterns(days = 7): Promise<Array<{ sourceName: string; field: string; count: number }>> {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const rows = await db.execute(sql`
      SELECT source_name, field, COUNT(*)::int AS c FROM story_edits
      WHERE edited_at > ${cutoff} AND source_name IS NOT NULL
      GROUP BY source_name, field
      ORDER BY c DESC
      LIMIT 20
    `);
    return (rows as any[]).map((r) => ({ sourceName: r.source_name, field: r.field, count: r.c }));
  }

  // ----- Classification rules -----
  async listClassificationRules(): Promise<ClassificationRule[]> {
    const rows = await db.select().from(classificationRules).orderBy(desc(classificationRules.priority), asc(classificationRules.id));
    return rows.map(rowToRule);
  }

  async createClassificationRule(input: Omit<ClassificationRule, "id" | "hitCount">): Promise<ClassificationRule> {
    const rows = await db.insert(classificationRules).values({
      matchField: input.matchField,
      pattern: input.pattern,
      action: input.action,
      value: input.value,
      priority: input.priority ?? 0,
      notes: input.notes ?? null,
      createdAt: input.createdAt,
      createdBy: input.createdBy ?? "admin",
      active: input.active === false ? false : true,
    }).returning();
    return rowToRule(rows[0]);
  }

  async updateClassificationRule(id: number, patch: Partial<Omit<ClassificationRule, "id">>): Promise<ClassificationRule | null> {
    const set: Record<string, any> = {};
    const keys: Array<keyof ClassificationRule> = ["matchField", "pattern", "action", "value", "priority", "notes", "active"];
    for (const k of keys) if (k in patch) set[k as string] = (patch as any)[k];
    if (Object.keys(set).length === 0) {
      const rows = await db.select().from(classificationRules).where(eq(classificationRules.id, id)).limit(1);
      return rows[0] ? rowToRule(rows[0]) : null;
    }
    const rows = await db.update(classificationRules).set(set).where(eq(classificationRules.id, id)).returning();
    return rows[0] ? rowToRule(rows[0]) : null;
  }

  async deleteClassificationRule(id: number): Promise<boolean> {
    const res = await db.delete(classificationRules).where(eq(classificationRules.id, id)).returning({ id: classificationRules.id });
    return res.length > 0;
  }

  async incrementRuleHitCount(id: number): Promise<void> {
    await db.execute(sql`UPDATE classification_rules SET hit_count = hit_count + 1 WHERE id = ${id}`);
  }

  // ----- History stories (long-form pool, also serves People desk) -----
  async listHistoryStories(cityId?: number): Promise<HistoryStory[]> {
    const conds: any[] = [eq(historyStories.isVisible, true)];
    if (cityId) conds.push(eq(historyStories.cityId, cityId));
    const rows = await db.select().from(historyStories).where(and(...conds)).orderBy(desc(historyStories.lastBumpedAt));
    return rows.map(rowToHistoryStory);
  }

  async listAllHistoryStoriesForDesk(desk: string, cityId?: number): Promise<HistoryStory[]> {
    const conds: any[] = [eq(historyStories.desk, desk)];
    if (cityId) conds.push(eq(historyStories.cityId, cityId));
    const rows = await db.select().from(historyStories).where(and(...conds)).orderBy(desc(historyStories.publishedAt));
    return rows.map(rowToHistoryStory);
  }

  async createHistoryStory(input: InsertHistoryStory): Promise<HistoryStory> {
    const rows = await db.insert(historyStories).values({
      headline: input.headline,
      summary: input.summary,
      sourceUrl: input.sourceUrl ?? null,
      desk: (input as any).desk ?? "history",
      kind: (input as any).kind ?? "history",
      publishedAt: input.publishedAt,
      lastBumpedAt: input.lastBumpedAt,
      isVisible: true,
    }).returning();
    return rowToHistoryStory(rows[0]);
  }

  async updateHistoryStory(id: number, patch: Partial<InsertHistoryStory>): Promise<HistoryStory | null> {
    const set: Record<string, any> = {};
    const keys: Array<keyof InsertHistoryStory> = ["headline", "summary", "sourceUrl", "desk", "kind", "lastBumpedAt"];
    for (const k of keys) if (k in patch) set[k as string] = (patch as any)[k];
    if ("isVisible" in (patch as any)) set.isVisible = (patch as any).isVisible;
    if (Object.keys(set).length === 0) {
      const rows = await db.select().from(historyStories).where(eq(historyStories.id, id)).limit(1);
      return rows[0] ? rowToHistoryStory(rows[0]) : null;
    }
    const rows = await db.update(historyStories).set(set).where(eq(historyStories.id, id)).returning();
    return rows[0] ? rowToHistoryStory(rows[0]) : null;
  }

  async setHistoryVisibility(ids: number[], visible: boolean): Promise<void> {
    if (!ids.length) return;
    await db.update(historyStories).set({ isVisible: visible }).where(inArray(historyStories.id, ids));
  }

  async markHistoryShownNow(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const now = new Date().toISOString();
    await db.update(historyStories).set({ lastShownAt: now }).where(inArray(historyStories.id, ids));
  }

  async bumpOldestHistoryStory(): Promise<void> {
    const oldest = await db.select({ id: historyStories.id }).from(historyStories).orderBy(asc(historyStories.lastBumpedAt)).limit(1);
    if (!oldest[0]) return;
    const now = new Date().toISOString();
    await db.update(historyStories).set({ lastBumpedAt: now }).where(eq(historyStories.id, oldest[0].id));
  }

  async countHistoryStories(): Promise<number> {
    const res = await db.select({ c: sql<number>`count(*)::int` }).from(historyStories);
    return res[0]?.c ?? 0;
  }

  async deleteHistoryStoryById(id: number): Promise<void> {
    await db.delete(historyStories).where(eq(historyStories.id, id));
  }

  // ----- Job posts -----
  async listJobPosts(state?: JobPostState, cityId?: number): Promise<JobPost[]> {
    const conds: any[] = [];
    if (state) conds.push(eq(jobPosts.state, state));
    if (cityId) conds.push(eq(jobPosts.cityId, cityId));
    const q = conds.length
      ? db.select().from(jobPosts).where(and(...conds)).orderBy(desc(jobPosts.submittedAt))
      : db.select().from(jobPosts).orderBy(desc(jobPosts.submittedAt));
    const rows = await q;
    return rows.map(rowToJobPost);
  }

  async getJobPost(id: number): Promise<JobPost | null> {
    const rows = await db.select().from(jobPosts).where(eq(jobPosts.id, id)).limit(1);
    return rows[0] ? rowToJobPost(rows[0]) : null;
  }

  async createJobPost(input: InsertJobPost): Promise<JobPost> {
    const submittedAt = new Date().toISOString();
    const rows = await db.insert(jobPosts).values({
      title: input.title.trim(),
      business: input.business.trim(),
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      pay: input.pay?.trim() || null,
      body: input.body.trim(),
      submitterEmail: input.submitterEmail?.trim() || null,
      state: "pending" as JobPostState,
      submittedAt,
    }).returning();
    return rowToJobPost(rows[0]);
  }

  async setJobPostState(id: number, state: JobPostState): Promise<JobPost | null> {
    const set: Record<string, any> = { state };
    if (state === "approved") set.approvedAt = new Date().toISOString();
    await db.update(jobPosts).set(set).where(eq(jobPosts.id, id));
    return this.getJobPost(id);
  }

  async deleteJobPost(id: number): Promise<boolean> {
    const res = await db.delete(jobPosts).where(eq(jobPosts.id, id)).returning({ id: jobPosts.id });
    return res.length > 0;
  }

  async countJobPosts(state?: JobPostState): Promise<number> {
    const q = state
      ? await db.select({ c: sql<number>`count(*)::int` }).from(jobPosts).where(eq(jobPosts.state, state))
      : await db.select({ c: sql<number>`count(*)::int` }).from(jobPosts);
    return q[0]?.c ?? 0;
  }

  // ----- Meta key/value -----
  async getMeta(key: string): Promise<string | null> {
    const rows = await db.select().from(meta).where(eq(meta.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await db.execute(sql`INSERT INTO meta (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }
}

export const storage = new DatabaseStorage();
