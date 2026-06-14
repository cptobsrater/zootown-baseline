/**
 * Postgres-backed storage for ZooTown (Supabase).
 *
 * All methods are async. The schema lives in shared/schema.ts.
 * Tables are created via Supabase migrations (managed separately) — this
 * module does NOT create tables; it only reads/writes.
 */
import {
  stories, events, sources, ingestRuns, storySources, storyEdits,
  historyStories, classificationRules, meta, cities,
  feedPresets, feedPresetEvents,
  feedback,
  storyDeletions,
  sponsors, sponsorCities,
  eventQuarantine,
  buildFilterSignature,
} from "../shared/schema.js";
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
  FeedPreset,
  InsertFeedPreset,
  FeedPresetConfig,
  FeedPresetEvent,
  InsertFeedPresetEvent,
  FeedPresetAction,
  Feedback,
  InsertFeedback,
  FeedbackStatus,
  StoryDeletion,
  InsertStoryDeletion,
  StoryDeletionReason,
  Sponsor,
  InsertSponsor,
  SponsorCity,
  SponsorWithCities,
  SponsorEditInput,
  EventQuarantineRow,
  InsertEventQuarantine,
  EventQuarantineStatus,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, asc, and, gte, lte, lt, or, isNull, sql, inArray, ne } from "drizzle-orm";
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
  // Public-feed rebalance: when true AND no desk filter is active AND cursor=0,
  // fetch a deeper buffer and prune any single desk down to ~35% of the page
  // so the client interleaver always has variety to work with. Off by default
  // so the admin Inbox stays in strict chronological order.
  rebalance?: boolean;
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
    onCalendar: (() => {
      // Defensive guard: a row is only "on the calendar" if we have solid
      // confidence in its start time. A real event needs a starts_at value
      // that is *distinct* from published_at -- if they collide within ~60s
      // it's almost certainly a seeder slamming now() into both columns, not
      // a real event time. Drop the calendar flag on the way out rather than
      // leak a fabricated time to the UI. Better to show the row as plain
      // news than to mislead readers about when something starts.
      const flagged =
        r.on_calendar === true || r.on_calendar === 1 || r.onCalendar === true;
      if (!flagged) return false;
      const startsRaw = r.starts_at ?? r.startsAt ?? null;
      if (!startsRaw) return false;
      const startsMs = Date.parse(startsRaw);
      const publishedMs = Date.parse(r.published_at ?? r.publishedAt ?? "");
      if (Number.isFinite(startsMs) && Number.isFinite(publishedMs)) {
        if (Math.abs(startsMs - publishedMs) < 60_000) return false;
      }
      return true;
    })(),
    venue: r.venue ?? null,
    startsAt: r.starts_at ?? r.startsAt ?? null,
    endsAt: r.ends_at ?? r.endsAt ?? null,
    isReviewed: r.is_reviewed === true || r.is_reviewed === 1 || r.isReviewed === true,
    reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
    cityId: r.city_id ?? r.cityId ?? null,
    // Phase 6: classifier signals (default to 1.0 / [] for legacy rows).
    confidence: (() => {
      const raw = r.confidence;
      if (raw == null) return "1.00";
      // Postgres NUMERIC returns string via postgres-js — keep string for the
      // type but coerce 0..1 number if it came that way.
      return typeof raw === "number" ? raw.toFixed(2) : String(raw);
    })() as any,
    altDesks: Array.isArray(r.alt_desks)
      ? (r.alt_desks as string[])
      : Array.isArray(r.altDesks)
      ? (r.altDesks as string[])
      : [],
    // Editorial pinning. Returned as ISO string when pinned, null otherwise.
    pinnedAt: (() => {
      const raw = r.pinned_at ?? r.pinnedAt ?? null;
      if (!raw) return null;
      return raw instanceof Date ? raw.toISOString() : String(raw);
    })(),
    // Synthesis attribution (Phase 12). Defaults match the column defaults
    // for rows written before this column existed.
    isSynthesis: Boolean(r.is_synthesis ?? r.isSynthesis ?? false),
    synthesizedFromIds: Array.isArray(r.synthesized_from_ids)
      ? (r.synthesized_from_ids as number[])
      : Array.isArray(r.synthesizedFromIds)
      ? (r.synthesizedFromIds as number[])
      : [],
    clusterId: (r.cluster_id ?? r.clusterId ?? null) as number | null,
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
    // Phase 14: stories now carries the link fields too. Read from
    // both snake_case (raw SQL paths) and camelCase (Drizzle paths).
    primaryLink: r.primary_link ?? r.primaryLink ?? null,
    linkType: r.link_type ?? r.linkType ?? null,
    fbUrl: r.fb_url ?? r.fbUrl ?? null,
    venueUrl: r.venue_url ?? r.venueUrl ?? null,
    sourceConfidence: r.source_confidence ?? r.sourceConfidence ?? 1,
    linkVerifiedAt: r.link_verified_at ?? r.linkVerifiedAt ?? null,
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
    // Phase 14 link fields. snake_case from raw SQL, camelCase from Drizzle.
    primaryLink: r.primary_link ?? r.primaryLink ?? null,
    linkType: r.link_type ?? r.linkType ?? null,
    fbUrl: r.fb_url ?? r.fbUrl ?? null,
    venueUrl: r.venue_url ?? r.venueUrl ?? null,
    sourceConfidence: r.source_confidence ?? r.sourceConfidence ?? 1,
    linkVerifiedAt: r.link_verified_at ?? r.linkVerifiedAt ?? null,
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
  // Pin / unpin a story. true = pin now (sets pinned_at = now()),
  // false = unpin (sets pinned_at = NULL).
  setStoryPinned(id: number, pinned: boolean): Promise<Story | undefined>;
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
  // Phase 6: feed presets + composite-feed query
  listStoriesByPreset(
    config: FeedPresetConfig,
    opts?: { cityId?: number; cursor?: number; limit?: number; queryOverride?: string },
  ): Promise<{ items: Story[]; nextCursor: number | null; total: number }>;
  createFeedPreset(input: InsertFeedPreset): Promise<FeedPreset>;
  getFeedPreset(id: number): Promise<FeedPreset | undefined>;
  listFeedPresets(opts?: {
    ownerId?: string | null;
    cityId?: number | null;
    includeInactive?: boolean;
  }): Promise<FeedPreset[]>;
  updateFeedPreset(
    id: number,
    patch: Partial<Omit<InsertFeedPreset, "ownerId">>,
  ): Promise<FeedPreset | undefined>;
  softDeleteFeedPreset(id: number): Promise<boolean>;
  reorderFeedPresets(items: Array<{ id: number; sortOrder: number }>): Promise<void>;
  recordFeedPresetEvent(input: {
    presetId?: number | null;
    cityId?: number | null;
    adminId?: string | null;
    action: FeedPresetAction;
    config: FeedPresetConfig | null;
    payload?: Record<string, unknown> | null;
  }): Promise<FeedPresetEvent>;
  topFilterSignatures(opts?: {
    sinceDays?: number;
    cityId?: number | null;
    limit?: number;
  }): Promise<Array<{ filterSignature: string; uses: number }>>;

  // ----- Phase 7: user feedback -----
  createFeedback(input: InsertFeedback): Promise<Feedback>;
  listFeedback(opts?: {
    status?: FeedbackStatus | "all";
    citySlug?: string;
    limit?: number;
  }): Promise<Feedback[]>;
  countOpenFeedback(): Promise<number>;
  updateFeedback(
    id: number,
    fields: Partial<Pick<Feedback, "status" | "adminNote">>,
  ): Promise<Feedback | undefined>;

  // ----- Phase 8: reasoned story deletion -----
  recordAndDeleteStory(
    storyId: number,
    ctx: { reason: string; reasonCategory: StoryDeletionReason; adminId?: string | null },
  ): Promise<StoryDeletion | undefined>;
  listStoryDeletions(opts?: {
    category?: StoryDeletionReason;
    sinceDays?: number;
    limit?: number;
  }): Promise<StoryDeletion[]>;

  // ----- Phase 8: sponsors (replaces static client/src/lib/sponsors.ts) -----
  listSponsorsWithCities(opts?: { activeOnly?: boolean }): Promise<SponsorWithCities[]>;
  listSponsorsForCity(citySlug: string): Promise<SponsorWithCities[]>;
  updateSponsor(id: string, patch: SponsorEditInput): Promise<SponsorWithCities | undefined>;
  createSponsor(
    insert: InsertSponsor,
    cities: { citySlug: string; sortOrder: number }[],
  ): Promise<SponsorWithCities>;
  deleteSponsor(id: string): Promise<boolean>;
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
    // Defensive guard: never return future-dated rows on the public feed.
    // Some seeders + bad ingest data have stamped published_at with
    // now()+offset, which then permanently dominates the chronological
    // top of the feed (e.g. "Lady Griz vs. Idaho State" pinned for weeks).
    // For the admin Inbox we keep modState='all' rows visible so the admin
    // can find and fix them; everywhere else we hide future timestamps.
    if (modState === "approved") {
      conditions.push(sql`${stories.publishedAt}::timestamptz <= now() + interval '5 minutes'`);
    }
    if (needle) {
      conditions.push(sql`(lower(${stories.headline}) LIKE ${needle} OR lower(${stories.summary}) LIKE ${needle} OR lower(${stories.tags}) LIKE ${needle} OR lower(coalesce(${stories.location}, '')) LIKE ${needle})`);
    }
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const totalRes = await db.select({ c: sql<number>`count(*)::int` }).from(stories).where(whereClause as any);
    const total = totalRes[0]?.c ?? 0;

    // ----- Rebalance path -----
    // Triggered only on the public feed's first page when no desk filter is
    // active. The unbalanced case is an Eventbrite/aggregator burst stamping
    // dozens of same-desk rows with near-identical published_at values, which
    // dominates the chronological top of the feed. We fix that here so the
    // client interleaver has variety to alternate with on page 1.
    const noDeskFilter =
      !(q.desks && q.desks.length > 0) && (!q.desk || q.desk === "all");
    const shouldRebalance =
      q.rebalance === true && cursor === 0 && noDeskFilter && !needle;
    if (shouldRebalance) {
      // Cap any one desk at ~35% of the page. For limit=10 that is 3-4 rows;
      // for limit=20 it is 7. Floor at 2 so tiny pages still work.
      const perDeskCap = Math.max(2, Math.ceil(limit * 0.35));

      // Pre-pass: pinned rows always go first, in newest-pin order, and DO
      // NOT count against any desk's cap. This means an admin can pin up to
      // limit rows and they'll all surface, but the diversity rule still
      // applies to whatever unpinned content fills the rest of the page.
      const pinnedRows = await db
        .select()
        .from(stories)
        .where(
          and(whereClause as any, sql`${stories.pinnedAt} IS NOT NULL`) as any,
        )
        .orderBy(desc(stories.pinnedAt as any))
        .limit(limit);
      const pinnedItems = (pinnedRows as any[]).map(rowToStory);
      const pinnedIds = new Set(pinnedItems.map((s) => s.id));
      const remainingLimit = Math.max(0, limit - pinnedItems.length);

      // Stratified fetch: pull the newest perDeskCap+1 rows from EACH desk
      // present in the city via a window function. This guarantees variety
      // even when one desk (e.g. an Eventbrite burst) has hundreds of rows
      // at the chronological top -- the top per-desk slots are independent.
      // Drizzle does not have a clean .raw chainable; we hand-build the SQL.
      const perDeskFetch = perDeskCap + 2; // a little headroom for picking
      const baseWhere = whereClause as any;
      // Window-function pull: rank stories per desk by published_at DESC.
      // We pull up to `perDeskFetch` rows per desk, then in JS interleave
      // them in chronological order so the page still feels "newest first".
      const stratifiedRows = await db.execute(sql`
        WITH ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY desk ORDER BY published_at DESC) AS rn
          FROM stories
          WHERE ${baseWhere ?? sql`TRUE`}
            AND pinned_at IS NULL
        )
        SELECT * FROM ranked WHERE rn <= ${perDeskFetch}
        ORDER BY published_at DESC
      `);
      // postgres-js returns the rows as a plain array on .execute().
      const buffer = ((stratifiedRows as unknown as any[]) || [])
        .map(rowToStory)
        .filter((s) => !pinnedIds.has(s.id));

      // Pick chronologically while enforcing the per-desk cap. Any rows that
      // would push a desk over its cap go into `overflow` and only get used
      // if the page can't be filled otherwise ("feed ran out" rule).
      const counts = new Map<string, number>();
      const picked: Story[] = [];
      const overflow: Story[] = [];
      for (const s of buffer) {
        const d = s.desk ?? "";
        const used = counts.get(d) ?? 0;
        if (used < perDeskCap && picked.length < remainingLimit) {
          picked.push(s);
          counts.set(d, used + 1);
        } else {
          overflow.push(s);
        }
      }
      while (picked.length < remainingLimit && overflow.length > 0) {
        picked.push(overflow.shift()!);
      }
      // Prepend pinned rows so they always lead the page.
      const finalPicked = [...pinnedItems, ...picked];
      // From here on, `picked` refers to the pinned-plus-stratified result.
      // Page 2 falls back to raw chronological from the appropriate offset.
      // Use `limit` as the next cursor offset -- the client treats page 2 as
      // "next limit rows in chronological order", which is fine because the
      // dominant-desk rows we deferred on page 1 will reappear there.
      const nextCursor = finalPicked.length >= limit && total > limit ? limit : null;
      return { items: finalPicked, nextCursor, total };
    }

    // Pinned rows float to the top of every feed they appear in. Among
    // multiple pinned rows, newest-pin-first. Among unpinned rows, the usual
    // newest-publish-first.
    const rows = await db
      .select()
      .from(stories)
      .where(whereClause as any)
      .orderBy(
        sql`${stories.pinnedAt} DESC NULLS LAST`,
        desc(stories.publishedAt),
      )
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
    const storyRow: any = {
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
      // Phase 14 link fields. Only present on rows produced by the curated
      // venue collector -- legacy ingest sources omit them and they default
      // to null / 1.
      primaryLink: (input as any).primaryLink ?? null,
      linkType: (input as any).linkType ?? null,
      fbUrl: (input as any).fbUrl ?? null,
      venueUrl: (input as any).venueUrl ?? null,
      sourceConfidence: (input as any).sourceConfidence ?? 1,
      linkVerifiedAt: (input as any).linkVerifiedAt ?? null,
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

  async setStoryPinned(id: number, pinned: boolean): Promise<Story | undefined> {
    // pinned_at carries both the on/off state AND the order among pins
    // (newer-pin-first), so we always stamp it with the current time on pin.
    const pinnedAt = pinned ? new Date().toISOString() : null;
    await db.update(stories).set({ pinnedAt }).where(eq(stories.id, id));
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
    fields: Partial<
      Pick<
        Story,
        | "headline"
        | "summary"
        | "desk"
        | "sourceUrl"
        | "sourceName"
        | "venue"
        | "startsAt"
        | "endsAt"
        | "onCalendar"
        | "modState"
        | "cityId"
        | "publishedAt"
        | "tags"
        | "location"
        | "isReviewed"
      >
    >,
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
    // ----- Extended editable fields wired by the cockpit's StoryEditDialog -----
    if (fields.modState !== undefined) set.modState = fields.modState;
    if (fields.cityId !== undefined) set.cityId = fields.cityId;
    if (fields.publishedAt !== undefined) set.publishedAt = fields.publishedAt;
    if (fields.tags !== undefined) set.tags = fields.tags;
    if (fields.location !== undefined) set.location = fields.location;
    if (fields.isReviewed !== undefined) {
      set.isReviewed = fields.isReviewed;
      // When an admin flips reviewed=true, stamp the timestamp so the
      // edit-log / training-signal pipeline can pick it up.
      if (fields.isReviewed) {
        set.reviewedAt = new Date().toISOString();
      }
    }
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

  // =================================================================
  // Phase 6: composite feed query + feed presets CRUD
  // =================================================================

  /**
   * Composite-feed query. Drives saved presets, the public /api/stories
   * endpoint when multi-desks are passed, and the admin inbox preset bar.
   *
   * Behavior:
   *   - desks empty / undefined  -> no desk filter ("All")
   *   - desks length === 1       -> single-desk fast path: WHERE desk = X
   *                                 (ignores alt_desks; matches the user's
   *                                  intent of "pure Sports feed")
   *   - desks length >  1        -> composite path: WHERE desk IN (...) OR
   *                                 alt_desks && desks. composite_confidence
   *                                 weights primary 1.0, alt-hit 0.85, miss 0.
   *   - sort='highest_confidence' -> ORDER BY composite_confidence DESC,
   *                                   published_at DESC
   *   - sort='oldest'             -> ORDER BY published_at ASC
   *   - default                   -> ORDER BY published_at DESC
   *
   * Returns the same shape as listStories() so call sites can swap freely.
   */
  async listStoriesByPreset(
    config: FeedPresetConfig,
    opts: {
      cityId?: number;
      cursor?: number;
      limit?: number;
      // Lets the admin override the preset's stored query at runtime
      // (e.g. type a search box on top of an active preset).
      queryOverride?: string;
    } = {},
  ): Promise<{ items: Story[]; nextCursor: number | null; total: number }> {
    const limit = opts.limit ?? 20;
    const cursor = opts.cursor ?? 0;
    const desks = [...(config.desks ?? [])].map((d) => d.toLowerCase()).sort();
    const multi = desks.length > 1;
    const single = desks.length === 1;

    // --- WHERE clauses ---
    const conditions: any[] = [];
    if (config.modState !== "all") {
      conditions.push(eq(stories.modState, config.modState));
    }
    if (opts.cityId) conditions.push(eq(stories.cityId, opts.cityId));
    if (config.isReviewed !== undefined) {
      conditions.push(eq(stories.isReviewed, config.isReviewed));
    }
    if (config.timeWindowHours && config.timeWindowHours > 0) {
      const cutoff = new Date(Date.now() - config.timeWindowHours * 3600 * 1000).toISOString();
      conditions.push(gte(stories.publishedAt, cutoff));
    }
    // Desk filter: empty = no filter, single = exact match, multi = OR with alt_desks overlap.
    //
    // Postgres array literal: we build `ARRAY[$1, $2, ...]::text[]` because
    // Drizzle's sql template expands a JS array into a tuple `($1, $2)` which
    // Postgres won't cast to text[]. sql.join with sql.param keeps the values
    // parameterized (no SQL injection) while letting us wrap them in ARRAY[...].
    const desksArraySql = sql`ARRAY[${sql.join(
      desks.map((d) => sql`${d}`),
      sql`, `,
    )}]::text[]`;
    if (single) {
      conditions.push(eq(stories.desk, desks[0]));
    } else if (multi) {
      conditions.push(
        or(
          inArray(stories.desk, desks),
          // alt_desks && ARRAY[...]::text[] -- row matches if any alt_desk is selected
          sql`${stories.altDesks} && ${desksArraySql}`,
        )!,
      );
    }
    // Free-text search. queryOverride beats config.query so the admin can
    // type on top of an active preset without overwriting it.
    const queryText = (opts.queryOverride ?? config.query ?? "").trim().toLowerCase();
    if (queryText) {
      const needle = `%${queryText}%`;
      conditions.push(
        sql`(lower(${stories.headline}) LIKE ${needle} OR lower(${stories.summary}) LIKE ${needle} OR lower(${stories.tags}) LIKE ${needle} OR lower(coalesce(${stories.location}, '')) LIKE ${needle})`,
      );
    }
    // Calendar-only sort variant: drop past events, sort by start time.
    if (config.display.sortByEventDate) {
      conditions.push(eq(stories.onCalendar, true));
      const nowIso = new Date().toISOString();
      conditions.push(
        or(
          and(isNull(stories.endsAt), gte(stories.startsAt, nowIso)),
          gte(stories.endsAt, nowIso),
        )!,
      );
    }
    const whereClause = conditions.length ? and(...conditions) : undefined;

    // --- Composite confidence expression ---
    // For single-desk and "all" feeds we just use the raw stored confidence.
    // For composite feeds we apply the 1.0 / 0.85 / 0 weighting at SELECT time.
    const compositeConfidenceSql = multi
      ? sql`
          (${stories.confidence}::numeric *
            CASE
              WHEN ${stories.desk} = ANY(${desksArraySql}) THEN 1.0
              WHEN ${stories.altDesks} && ${desksArraySql} THEN 0.85
              ELSE 0
            END)
        `
      : sql`${stories.confidence}::numeric`;

    // --- Total (no limit) ---
    const totalRes = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(stories)
      .where(whereClause as any);
    const total = totalRes[0]?.c ?? 0;

    // --- Paged select ---
    const orderBy = (() => {
      if (config.sort === "highest_confidence") {
        return [desc(compositeConfidenceSql), desc(stories.publishedAt)];
      }
      if (config.sort === "oldest") return [asc(stories.publishedAt)];
      if (config.display.sortByEventDate) {
        return [asc(stories.startsAt), desc(stories.publishedAt)];
      }
      return [desc(stories.publishedAt)];
    })();

    const rows = await db
      .select()
      .from(stories)
      .where(whereClause as any)
      .orderBy(...(orderBy as any))
      .limit(limit)
      .offset(cursor);

    const items = rows.map(rowToStory);
    const nextCursor = cursor + items.length < total ? cursor + items.length : null;
    return { items, nextCursor, total };
  }

  // ---- feed_presets CRUD ----

  async createFeedPreset(input: InsertFeedPreset): Promise<FeedPreset> {
    const rows = await db.insert(feedPresets).values(input as any).returning();
    return rows[0] as FeedPreset;
  }

  async getFeedPreset(id: number): Promise<FeedPreset | undefined> {
    const rows = await db.select().from(feedPresets).where(eq(feedPresets.id, id)).limit(1);
    return rows[0] as FeedPreset | undefined;
  }

  /**
   * List active presets visible to an admin. Returns:
   *   - shared/org presets (every admin sees these)
   *   - personal presets owned by `ownerId` when provided
   * Optionally filtered to a specific city (pinned or portable).
   */
  async listFeedPresets(opts: {
    ownerId?: string | null;
    cityId?: number | null;
    includeInactive?: boolean;
  } = {}): Promise<FeedPreset[]> {
    const conds: any[] = [];
    if (!opts.includeInactive) conds.push(eq(feedPresets.isActive, true));
    // Visibility: shared/org always; personal only for the owner.
    if (opts.ownerId) {
      conds.push(
        or(
          inArray(feedPresets.scope, ["shared", "org"]),
          and(eq(feedPresets.scope, "personal"), eq(feedPresets.ownerId, opts.ownerId))!,
        )!,
      );
    } else {
      conds.push(inArray(feedPresets.scope, ["shared", "org"]));
    }
    // Optional city filter: pinned to this city OR portable (city_id NULL).
    if (opts.cityId !== undefined && opts.cityId !== null) {
      conds.push(or(isNull(feedPresets.cityId), eq(feedPresets.cityId, opts.cityId))!);
    }
    const rows = await db
      .select()
      .from(feedPresets)
      .where(and(...conds) as any)
      .orderBy(asc(feedPresets.sortOrder), asc(feedPresets.id));
    return rows as FeedPreset[];
  }

  /** Patch an existing preset. Bumps configVersion when `config` changes. */
  async updateFeedPreset(
    id: number,
    patch: Partial<Omit<InsertFeedPreset, "ownerId">>,
  ): Promise<FeedPreset | undefined> {
    const set: Record<string, any> = { ...patch, updatedAt: new Date().toISOString() };
    if (patch.config !== undefined) {
      const rows = await db
        .update(feedPresets)
        .set({ ...set, configVersion: sql`${feedPresets.configVersion} + 1` })
        .where(eq(feedPresets.id, id))
        .returning();
      return rows[0] as FeedPreset | undefined;
    }
    const rows = await db.update(feedPresets).set(set).where(eq(feedPresets.id, id)).returning();
    return rows[0] as FeedPreset | undefined;
  }

  /** Soft-delete: flip is_active=false. Keeps usage events linked. */
  async softDeleteFeedPreset(id: number): Promise<boolean> {
    const rows = await db
      .update(feedPresets)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(feedPresets.id, id))
      .returning({ id: feedPresets.id });
    return rows.length > 0;
  }

  /** Reorder presets in bulk. Caller passes [id, sortOrder] pairs. */
  async reorderFeedPresets(items: Array<{ id: number; sortOrder: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const it of items) {
      await db
        .update(feedPresets)
        .set({ sortOrder: it.sortOrder, updatedAt: new Date().toISOString() })
        .where(eq(feedPresets.id, it.id));
    }
  }

  // ---- feed_preset_events: append-only telemetry ----

  async recordFeedPresetEvent(input: {
    presetId?: number | null;
    cityId?: number | null;
    adminId?: string | null;
    action: FeedPresetAction;
    config: FeedPresetConfig | null;
    payload?: Record<string, unknown> | null;
  }): Promise<FeedPresetEvent> {
    const filterSignature = buildFilterSignature({
      cityId: input.cityId ?? null,
      desks: input.config?.desks ?? [],
      modState: input.config?.modState ?? null,
      isReviewed: input.config?.isReviewed ?? null,
      timeWindowHours: input.config?.timeWindowHours ?? null,
      sort: input.config?.sort ?? null,
    });
    const rows = await db
      .insert(feedPresetEvents)
      .values({
        presetId: input.presetId ?? null,
        cityId: input.cityId ?? null,
        adminId: input.adminId ?? null,
        action: input.action,
        filterSignature,
        payload: input.payload ?? null,
      } as any)
      .returning();
    return rows[0] as FeedPresetEvent;
  }

  /**
   * Top filter signatures by usage in the last N days. Feeds the
   * "suggested presets" UI -- the most-applied filter combos that aren't
   * already saved as a preset by this admin.
   */
  async topFilterSignatures(opts: {
    sinceDays?: number;
    cityId?: number | null;
    limit?: number;
  } = {}): Promise<Array<{ filterSignature: string; uses: number }>> {
    const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 3600 * 1000).toISOString();
    const limit = opts.limit ?? 10;
    const cityClause = opts.cityId
      ? sql`AND city_id = ${opts.cityId}`
      : sql``;
    const rows = await db.execute(sql`
      SELECT filter_signature, COUNT(*)::int AS uses
      FROM feed_preset_events
      WHERE action = 'apply'
        AND at >= ${since}
        ${cityClause}
      GROUP BY filter_signature
      ORDER BY uses DESC
      LIMIT ${limit}
    `);
    return (rows as unknown as Array<{ filter_signature: string; uses: number }>).map((r) => ({
      filterSignature: r.filter_signature,
      uses: r.uses,
    }));
  }


  // ============================================================================
  // Phase 7: user feedback
  // ============================================================================

  async createFeedback(input: InsertFeedback): Promise<Feedback> {
    const rows = await db.insert(feedback).values(input as any).returning();
    return rows[0] as Feedback;
  }

  async listFeedback(opts: {
    status?: FeedbackStatus | "all";
    citySlug?: string;
    limit?: number;
  } = {}): Promise<Feedback[]> {
    const conds: any[] = [];
    if (opts.status && opts.status !== "all") {
      conds.push(eq(feedback.status, opts.status as any));
    }
    if (opts.citySlug) conds.push(eq(feedback.citySlug, opts.citySlug));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(feedback)
      .where(where as any)
      .orderBy(desc(feedback.createdAt))
      .limit(opts.limit ?? 200);
    return rows as Feedback[];
  }

  async countOpenFeedback(): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(feedback)
      .where(eq(feedback.status, "open" as any));
    return rows[0]?.c ?? 0;
  }

  async updateFeedback(
    id: number,
    fields: Partial<Pick<Feedback, "status" | "adminNote">>,
  ): Promise<Feedback | undefined> {
    const set: Record<string, any> = {};
    if (fields.status !== undefined) {
      set.status = fields.status;
      if (fields.status === "resolved") {
        set.resolvedAt = new Date().toISOString();
      }
    }
    if (fields.adminNote !== undefined) set.adminNote = fields.adminNote;
    if (Object.keys(set).length === 0) {
      const rows = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
      return rows[0] as Feedback | undefined;
    }
    const rows = await db.update(feedback).set(set).where(eq(feedback.id, id)).returning();
    return rows[0] as Feedback | undefined;
  }

  // ============================================================================
  // Phase 8: reasoned story deletion + deletion history
  // ============================================================================

  // Single-transaction-ish snapshot + delete. We don't wrap in a Postgres
  // transaction because the storage layer uses postgres-js's default mode
  // (no explicit transaction object) and the consequence of a half-failure
  // here is "deletion row exists but story still present" -- recoverable
  // and easy to spot via the admin UI. The opposite order (delete first,
  // then log) would lose the data we want to capture, so we always log first.
  async recordAndDeleteStory(
    storyId: number,
    ctx: { reason: string; reasonCategory: StoryDeletionReason; adminId?: string | null },
  ): Promise<StoryDeletion | undefined> {
    const story = await this.getStory(storyId);
    if (!story) return undefined;
    const inserted = await db
      .insert(storyDeletions)
      .values({
        storyId: story.id,
        headline: story.headline,
        summary: story.summary,
        desk: story.desk,
        cityId: story.cityId ?? null,
        sourceName: story.sourceName,
        sourceUrl: story.sourceUrl,
        modState: story.modState,
        publishedAt: story.publishedAt,
        reason: ctx.reason,
        reasonCategory: ctx.reasonCategory as any,
        adminId: ctx.adminId ?? null,
      } as any)
      .returning();
    // Now drop the story (cascade-deletes its sources via the existing helper).
    await this.deleteStory(storyId);
    return inserted[0] as StoryDeletion;
  }

  async listStoryDeletions(opts: {
    category?: StoryDeletionReason;
    sinceDays?: number;
    limit?: number;
  } = {}): Promise<StoryDeletion[]> {
    const conds: any[] = [];
    if (opts.category) conds.push(eq(storyDeletions.reasonCategory, opts.category as any));
    if (opts.sinceDays && opts.sinceDays > 0) {
      conds.push(sql`${storyDeletions.deletedAt} >= now() - (${opts.sinceDays} || ' days')::interval`);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(storyDeletions)
      .where(where as any)
      .orderBy(desc(storyDeletions.deletedAt))
      .limit(opts.limit ?? 200);
    return rows as StoryDeletion[];
  }

  // ----- Sponsors -----
  // Fan out one query into the parent table plus the join table, then stitch
  // the eligibility list onto each sponsor in JS. Could be a CTE, but the row
  // count is tiny (<50 ever) and the two-query form is far easier to read.
  async listSponsorsWithCities(
    opts: { activeOnly?: boolean } = {},
  ): Promise<SponsorWithCities[]> {
    const baseQuery = opts.activeOnly
      ? db.select().from(sponsors).where(eq(sponsors.isActive, true))
      : db.select().from(sponsors);
    const rows = (await baseQuery.orderBy(asc(sponsors.name))) as Sponsor[];
    if (rows.length === 0) return [];
    const cityRows = (await db
      .select()
      .from(sponsorCities)
      .where(inArray(sponsorCities.sponsorId, rows.map((r) => r.id)))) as SponsorCity[];
    const cityByPid = new Map<string, { citySlug: string; sortOrder: number }[]>();
    for (const r of cityRows) {
      const list = cityByPid.get(r.sponsorId) ?? [];
      list.push({ citySlug: r.citySlug, sortOrder: r.sortOrder });
      cityByPid.set(r.sponsorId, list);
    }
    return rows.map((s) => ({
      ...s,
      cities: (cityByPid.get(s.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }

  // Hot path for the public feed: only return sponsors eligible for one city,
  // sorted by sort_order. The cities array on the returned shape contains the
  // single eligibility row for THIS city, so the round-robin slot picker can
  // still read sortOrder if it wants.
  async listSponsorsForCity(citySlug: string): Promise<SponsorWithCities[]> {
    const rows = (await db
      .select({ s: sponsors, c: sponsorCities })
      .from(sponsors)
      .innerJoin(sponsorCities, eq(sponsorCities.sponsorId, sponsors.id))
      .where(and(eq(sponsors.isActive, true), eq(sponsorCities.citySlug, citySlug)))
      .orderBy(asc(sponsorCities.sortOrder))) as { s: Sponsor; c: SponsorCity }[];
    return rows.map(({ s, c }) => ({
      ...s,
      cities: [{ citySlug: c.citySlug, sortOrder: c.sortOrder }],
    }));
  }

  async updateSponsor(
    id: string,
    patch: SponsorEditInput,
  ): Promise<SponsorWithCities | undefined> {
    const fields: Record<string, unknown> = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.logoUrl !== undefined) fields.logoUrl = patch.logoUrl;
    if (patch.logoAlt !== undefined) fields.logoAlt = patch.logoAlt;
    if (patch.address !== undefined) fields.address = patch.address;
    if (patch.phone !== undefined) fields.phone = patch.phone;
    if (patch.tagline !== undefined) fields.tagline = patch.tagline;
    if (patch.href !== undefined) fields.href = patch.href;
    if (patch.instagram !== undefined) fields.instagram = patch.instagram;
    if (patch.facebook !== undefined) fields.facebook = patch.facebook;
    if (patch.isActive !== undefined) fields.isActive = patch.isActive;
    fields.updatedAt = new Date().toISOString();

    await db.update(sponsors).set(fields as any).where(eq(sponsors.id, id));

    // cities is a SET replacement when provided -- the client sends the full
    // desired eligibility list and we mirror it.
    if (patch.cities !== undefined) {
      await db.delete(sponsorCities).where(eq(sponsorCities.sponsorId, id));
      if (patch.cities.length > 0) {
        await db.insert(sponsorCities).values(
          patch.cities.map((c) => ({
            sponsorId: id,
            citySlug: c.citySlug,
            sortOrder: c.sortOrder,
          })),
        );
      }
    }

    const all = await this.listSponsorsWithCities();
    return all.find((s) => s.id === id);
  }

  async createSponsor(
    insert: InsertSponsor,
    cityList: { citySlug: string; sortOrder: number }[],
  ): Promise<SponsorWithCities> {
    await db.insert(sponsors).values(insert);
    if (cityList.length > 0) {
      await db.insert(sponsorCities).values(
        cityList.map((c) => ({
          sponsorId: insert.id,
          citySlug: c.citySlug,
          sortOrder: c.sortOrder,
        })),
      );
    }
    const all = await this.listSponsorsWithCities();
    const created = all.find((s) => s.id === insert.id);
    if (!created) throw new Error(`createSponsor: row ${insert.id} not found after insert`);
    return created;
  }

  async deleteSponsor(id: string): Promise<boolean> {
    // sponsor_cities cascades on delete, so we only need to remove the parent.
    const result = await db.delete(sponsors).where(eq(sponsors.id, id));
    return ((result as any)?.rowCount ?? 0) > 0;
  }

  // ----- Event quarantine -----
  // Holds calendar items that failed strict start-time validation. Admins
  // release them (with a corrected time) or reject them outright.

  async createQuarantinedEvent(input: InsertEventQuarantine): Promise<EventQuarantineRow> {
    const [row] = await db.insert(eventQuarantine).values(input).returning();
    return row;
  }

  async listQuarantinedEvents(status: EventQuarantineStatus = "pending", limit = 100): Promise<EventQuarantineRow[]> {
    const rows = await db
      .select()
      .from(eventQuarantine)
      .where(eq(eventQuarantine.status, status))
      .orderBy(desc(eventQuarantine.createdAt))
      .limit(limit);
    return rows;
  }

  async getQuarantinedEvent(id: number): Promise<EventQuarantineRow | undefined> {
    const rows = await db.select().from(eventQuarantine).where(eq(eventQuarantine.id, id)).limit(1);
    return rows[0];
  }

  async updateQuarantinedEvent(
    id: number,
    patch: Partial<Pick<EventQuarantineRow, "status" | "reviewer" | "reviewedAt" | "reviewerNote" | "releasedStoryId">>,
  ): Promise<EventQuarantineRow | undefined> {
    const [row] = await db
      .update(eventQuarantine)
      .set({ ...patch, updatedAt: new Date().toISOString() } as any)
      .where(eq(eventQuarantine.id, id))
      .returning();
    return row;
  }

  async countQuarantinedByStatus(): Promise<Record<EventQuarantineStatus, number>> {
    const rows = (await db.execute(
      sql`SELECT status, COUNT(*)::int AS count FROM event_quarantine GROUP BY status`,
    )) as unknown as { status: EventQuarantineStatus; count: number }[];
    const out: Record<EventQuarantineStatus, number> = { pending: 0, released: 0, rejected: 0 };
    for (const r of rows) out[r.status] = r.count;
    return out;
  }
}

export const storage = new DatabaseStorage();
