import {
  pgTable, text, integer, serial, bigserial, boolean, doublePrecision,
  numeric, jsonb, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Supported Montana cities. Each is a separate scope: news feed, sources,
// calendar, history pool, jobs, admin all key off the city's slug.
export const cities = pgTable("cities", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  state: text("state").notNull().default("MT"),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  countyName: text("county_name"),
  nwsZone: text("nws_zone"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: text("created_at").notNull(),
});
export type City = typeof cities.$inferSelect;
export const CITY_SLUGS = [
  "missoula", "billings", "greatfalls", "bozeman", "butte",
  "helena", "kalispell", "havre", "whitefish", "laurel",
] as const;
export type CitySlug = (typeof CITY_SLUGS)[number];

// Desk identifiers — EXACT ORDER matters for UI tabs
export const DESKS = ["city", "business", "crime", "sports", "health", "entertainment", "people", "history"] as const;
export type Desk = (typeof DESKS)[number];
export const RETIRED_DESKS = ["politics", "science_tech", "events"] as const;
export type RetiredDesk = (typeof RETIRED_DESKS)[number];

export const POLITICAL_SCOPES = ["local", "state", "national"] as const;
export type PoliticalScope = (typeof POLITICAL_SCOPES)[number];

export const SOURCE_TYPES = ["Official", "Local News", "Community Calendar", "Social Media"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_CATEGORIES = ["official", "news", "calendars", "social"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const STATUS = ["New", "Updated", "Event", "Developing"] as const;
export type Status = (typeof STATUS)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const MOD_STATE = ["draft", "approved", "rejected"] as const;
export type ModState = (typeof MOD_STATE)[number];

export const stories = pgTable("stories", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters"),
  desk: text("desk").notNull(),
  tags: text("tags").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  location: text("location"),
  status: text("status"),
  riskLevel: text("risk_level").notNull().default("low"),
  isSeeded: boolean("is_seeded").notNull().default(true),
  modState: text("mod_state").notNull().default("approved"),
  politicalScope: text("political_scope"),
  eventDate: text("event_date"),
  // Community calendar membership. on_calendar = true means this row shows on the
  // calendar AND requires a non-null starts_at (date+time of the event).
  // Stories without a future date stay off the calendar; they still appear in
  // their desk feed.
  onCalendar: boolean("on_calendar").notNull().default(false),
  venue: text("venue"),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  // Manual-review workflow: false = auto-published, true = admin-verified
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedAt: text("reviewed_at"),
  // Multi-city: which city this story belongs to. 1 = Missoula (legacy default).
  cityId: integer("city_id").references(() => cities.id),
  // Classifier signals for composite feeds. Confidence is 0..1.
  // Existing rows are backfilled to 1.0 in migration 0001.
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull().default("1.0"),
  // Secondary desks. Used by composite (multi-desk) feeds via the
  // `alt_desks && ARRAY[...]` overlap query. Default = empty array.
  altDesks: text("alt_desks").array().notNull().default(sql`ARRAY[]::text[]`),
  // Editorial pinning: NULL = not pinned, non-NULL = pinned and the row
  // floats to the top of any feed, newest-pin-first.
  // Migration: supabase/migrations/0005_story_pinning.sql
  pinnedAt: timestamp("pinned_at", { mode: "string", withTimezone: true }),
  // Synthesis attribution (Migration: 0010_synthesis.sql)
  // A synthesis story is one ZooTown produced by reading multiple sources
  // and writing a neutral, factual summary. synthesizedFromIds points back
  // to the source stories that fed the synthesis.
  isSynthesis: boolean("is_synthesis").notNull().default(false),
  synthesizedFromIds: integer("synthesized_from_ids")
    .array()
    .notNull()
    .default(sql`ARRAY[]::integer[]`),
  // When the story originated from a cluster, this links back so we can
  // show the audit trail in the cockpit.
  clusterId: integer("cluster_id"),
});
export const insertStorySchema = createInsertSchema(stories).omit({ id: true });
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof stories.$inferSelect;

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  venue: text("venue").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  tag: text("tag"),
  desk: text("desk"),
  description: text("description"),
  cityId: integer("city_id").references(() => cities.id),
});
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EventItem = typeof events.$inferSelect;

export const historyStories = pgTable("history_stories", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  sourceUrl: text("source_url"),
  desk: text("desk").notNull().default("history"),
  kind: text("kind").notNull().default("history"),
  publishedAt: text("published_at").notNull(),
  lastBumpedAt: text("last_bumped_at").notNull(),
  isVisible: boolean("is_visible").notNull().default(true),
  lastShownAt: text("last_shown_at"),
  cityId: integer("city_id").references(() => cities.id),
});
export const insertHistoryStorySchema = createInsertSchema(historyStories).omit({ id: true });
export type InsertHistoryStory = z.infer<typeof insertHistoryStorySchema>;
export type HistoryStory = typeof historyStories.$inferSelect;

export const JOB_POST_STATES = ["pending", "approved", "rejected"] as const;
export type JobPostState = (typeof JOB_POST_STATES)[number];

export const jobPosts = pgTable("job_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  business: text("business").notNull(),
  address: text("address"),
  phone: text("phone"),
  pay: text("pay"),
  body: text("body").notNull(),
  submitterEmail: text("submitter_email"),
  state: text("state").$type<JobPostState>().notNull().default("pending"),
  submittedAt: text("submitted_at").notNull(),
  approvedAt: text("approved_at"),
  cityId: integer("city_id").references(() => cities.id),
});
export const insertJobPostSchema = createInsertSchema(jobPosts).omit({ id: true, state: true, submittedAt: true, approvedAt: true });
export type InsertJobPost = z.infer<typeof insertJobPostSchema>;
export type JobPost = typeof jobPosts.$inferSelect;

export const FEED_TYPES = ["rss", "atom", "html", "headless", "none"] as const;
export type FeedType = (typeof FEED_TYPES)[number];
export const INGEST_MODES = ["live", "mock", "mixed"] as const;
export type IngestMode = (typeof INGEST_MODES)[number];
export const SOURCE_STATUS = ["ok", "stale", "error", "idle"] as const;
export type SourceStatus = (typeof SOURCE_STATUS)[number];

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  feedUrl: text("feed_url"),
  feedType: text("feed_type").notNull().default("none"),
  parserKey: text("parser_key"),
  sourceType: text("source_type").notNull(),
  desks: text("desks").notNull(),
  categoryPriority: text("category_priority"),
  cadenceMinutes: integer("cadence_minutes").notNull().default(5),
  lastCheckedAt: text("last_checked_at"),
  lastStatus: text("last_status").notNull().default("idle"),
  lastMode: text("last_mode"),
  lastError: text("last_error"),
  lastItems: integer("last_items").notNull().default(0),
  active: boolean("active").notNull().default(true),
  category: text("category").notNull().default("official"),
  handle: text("handle"),
  platform: text("platform"),
  trustScore: integer("trust_score").notNull().default(50),
  cityId: integer("city_id").references(() => cities.id),
});
export const insertSourceSchema = createInsertSchema(sources).omit({ id: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sources.$inferSelect;

export const RULE_FIELDS = ["headline", "summary", "text", "source"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_ACTIONS = ["set_desk", "reject", "set_kind"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const classificationRules = pgTable("classification_rules", {
  id: serial("id").primaryKey(),
  matchField: text("match_field").notNull(),
  pattern: text("pattern").notNull(),
  action: text("action").notNull(),
  value: text("value").notNull(),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().default("admin"),
  hitCount: integer("hit_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  cityId: integer("city_id").references(() => cities.id),
});
export const insertClassificationRuleSchema = createInsertSchema(classificationRules).omit({ id: true, hitCount: true });
export type InsertClassificationRule = z.infer<typeof insertClassificationRuleSchema>;
export type ClassificationRule = typeof classificationRules.$inferSelect;

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  sourceName: text("source_name").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  mode: text("mode").notNull(),
  fetched: integer("fetched").notNull().default(0),
  added: integer("added").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  clustered: integer("clustered").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  cityId: integer("city_id").references(() => cities.id),
  message: text("message"),
});
export type IngestRun = typeof ingestRuns.$inferSelect;

export const storySources = pgTable("story_sources", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  addedAt: text("added_at").notNull(),
});
export type StorySource = typeof storySources.$inferSelect;

export const storyEdits = pgTable("story_edits", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull(),
  field: text("field").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  sourceName: text("source_name"),
  editedAt: text("edited_at").notNull(),
});
export type StoryEdit = typeof storyEdits.$inferSelect;

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// =====================================================================
// Feed presets (Phase 6) — saved composite-filter recipes for the admin
// editorial cockpit. Lets an admin save a Sports+Entertainment+Crime
// filter combination + city + search query + mod-state + time window as
// a reusable named recipe and pin it as a chip.
// =====================================================================

export const FEED_PRESET_SCOPES = ["personal", "shared", "org"] as const;
export type FeedPresetScope = (typeof FEED_PRESET_SCOPES)[number];

export const FEED_PRESET_SORTS = ["newest", "oldest", "highest_confidence"] as const;
export type FeedPresetSort = (typeof FEED_PRESET_SORTS)[number];

/**
 * The JSON config payload stored inside feed_presets.config.
 *
 * Validated by Zod on every write. Stored as JSONB so we can evolve the
 * shape without DDL — add a new optional field and old presets still load.
 */
export const feedPresetConfigSchema = z.object({
  // Empty array == "All". Order is irrelevant; server normalizes sorted.
  desks: z.array(z.enum(DESKS)).default([]),
  // Optional: pin to a specific city. Null/undefined = "follow current".
  citySlug: z.enum(CITY_SLUGS).optional(),
  // Mod state visibility. Public feed presets stay 'approved'; admin
  // review queues can flip this to 'draft' or 'all'.
  modState: z.enum(["all", "approved", "draft", "rejected"]).default("approved"),
  // Admin-review filter.
  isReviewed: z.boolean().optional(),
  // Stored search query. Most presets leave this empty.
  query: z.string().max(200).optional(),
  // Optional rolling time window in hours. Null = "all time".
  timeWindowHours: z.number().int().min(1).max(24 * 30).optional(),
  // Sort override. Default is newest-first.
  sort: z.enum(FEED_PRESET_SORTS).default("newest"),
  // Composite display options.
  display: z
    .object({
      showDeskStripes: z.boolean().default(true),
      sortByEventDate: z.boolean().default(false),
    })
    .default({ showDeskStripes: true, sortByEventDate: false }),
  // Structured signals for the suggestion engine + future ML defaulting.
  signals: z
    .object({
      origin: z.enum(["manual", "suggested", "imported"]).default("manual"),
    })
    .default({ origin: "manual" }),
});
export type FeedPresetConfig = z.infer<typeof feedPresetConfigSchema>;

export const feedPresets = pgTable(
  "feed_presets",
  {
    id: serial("id").primaryKey(),
    // Admin user id. Treated as opaque string — ties to admin_tokens.
    // Required when scope='personal'; nullable for shared/org presets.
    ownerId: text("owner_id"),
    scope: text("scope").$type<FeedPresetScope>().notNull().default("personal"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    config: jsonb("config").$type<FeedPresetConfig>().notNull(),
    cityId: integer("city_id").references(() => cities.id),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
    configVersion: integer("config_version").notNull().default(1),
  },
  (t) => ({
    scopeActiveIdx: index("feed_presets_scope_active_idx").on(t.scope, t.isActive),
    cityIdx: index("feed_presets_city_idx").on(t.cityId),
  }),
);

export const insertFeedPresetSchema = createInsertSchema(feedPresets, {
  config: feedPresetConfigSchema,
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedPreset = z.infer<typeof insertFeedPresetSchema>;
export type FeedPreset = typeof feedPresets.$inferSelect;

export const FEED_PRESET_ACTIONS = [
  "apply", "save", "update", "delete", "suggest_seen", "suggest_apply",
] as const;
export type FeedPresetAction = (typeof FEED_PRESET_ACTIONS)[number];

export const feedPresetEvents = pgTable(
  "feed_preset_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    presetId: integer("preset_id").references(() => feedPresets.id),
    // Deterministic hash of the filter combination (cityId, sorted desks,
    // modState, isReviewed, timeWindowHours, sort). Same filter combos
    // roll up across admins for the suggestion engine.
    filterSignature: text("filter_signature").notNull(),
    adminId: text("admin_id"),
    cityId: integer("city_id").references(() => cities.id),
    action: text("action").$type<FeedPresetAction>().notNull(),
    payload: jsonb("payload"),
    at: timestamp("at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    presetAtIdx: index("fpe_preset_at_idx").on(t.presetId, t.at),
    signatureIdx: index("fpe_signature_idx").on(t.filterSignature, t.cityId, t.at),
    adminAtIdx: index("fpe_admin_at_idx").on(t.adminId, t.at),
  }),
);

export type FeedPresetEvent = typeof feedPresetEvents.$inferSelect;
export const insertFeedPresetEventSchema = createInsertSchema(feedPresetEvents).omit({
  id: true,
  at: true,
});
export type InsertFeedPresetEvent = z.infer<typeof insertFeedPresetEventSchema>;

/**
 * Deterministic filter signature for the suggestion engine.
 * Equivalent filter combos always hash to the same string — enables
 * cross-admin rollups ("this combo has been opened 47 times this week").
 */
export function buildFilterSignature(input: {
  cityId?: number | null;
  desks?: string[];
  modState?: string | null;
  isReviewed?: boolean | null;
  timeWindowHours?: number | null;
  sort?: string | null;
}): string {
  const desks = [...(input.desks ?? [])].map((d) => d.toLowerCase()).sort();
  const parts = [
    `c=${input.cityId ?? "any"}`,
    `d=${desks.join("+") || "all"}`,
    `m=${input.modState ?? "approved"}`,
    `r=${input.isReviewed == null ? "any" : input.isReviewed ? "yes" : "no"}`,
    `w=${input.timeWindowHours ?? "all"}`,
    `s=${input.sort ?? "newest"}`,
  ];
  return parts.join(";");
}

// ============================================================================
// Phase 7: User feedback (public submissions -> admin cockpit triage)
// ============================================================================

export const FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "archived"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    body: text("body").notNull(),
    name: text("name"),
    email: text("email"),
    citySlug: text("city_slug"),
    pageUrl: text("page_url"),
    userAgent: text("user_agent"),
    status: text("status").$type<FeedbackStatus>().notNull().default("open"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { mode: "string", withTimezone: true }),
  },
  (t) => ({
    byStatus: index("feedback_status_created_idx").on(t.status, t.createdAt),
  }),
);

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = typeof feedback.$inferInsert;

// Validation schema for the public POST /api/feedback endpoint. All
// rate-limiting + spam guardrails live in the route handler; this is
// just shape validation.
export const submitFeedbackSchema = z.object({
  body: z.string().min(5, "Tell us a bit more").max(4000, "Please trim this down"),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("That doesn't look like a valid email").max(200).optional().or(z.literal("")),
  citySlug: z.string().trim().max(40).optional().or(z.literal("")),
  pageUrl: z.string().trim().max(800).optional().or(z.literal("")),
});
export type SubmitFeedback = z.infer<typeof submitFeedbackSchema>;

// ============================================================================
// Phase 8: Reasoned story deletions
//
// Each cockpit delete writes one row here BEFORE the story is dropped, so we
// retain a permanent training signal even after the story itself is gone.
// reasonCategory is the AI-feedback key; reason is the free-text detail.
// ============================================================================

export const STORY_DELETION_REASONS = [
  "wrong_city",
  "non_english",
  "duplicate",
  "spam",
  "low_quality",
  "wrong_desk",
  "wrong_event_data",
  "outdated",
  "opinion_or_editorial",
  "job_posting",
  "classified",
  "other",
] as const;
export type StoryDeletionReason = (typeof STORY_DELETION_REASONS)[number];

export const storyDeletions = pgTable(
  "story_deletions",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary"),
    desk: text("desk"),
    cityId: integer("city_id"),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    modState: text("mod_state"),
    publishedAt: timestamp("published_at", { mode: "string", withTimezone: true }),
    reason: text("reason").notNull(),
    reasonCategory: text("reason_category").$type<StoryDeletionReason>().notNull(),
    adminId: text("admin_id"),
    deletedAt: timestamp("deleted_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCategory: index("story_deletions_category_idx").on(t.reasonCategory, t.deletedAt),
    bySource: index("story_deletions_source_idx").on(t.sourceName, t.deletedAt),
    byDesk: index("story_deletions_desk_idx").on(t.desk, t.deletedAt),
  }),
);

export type StoryDeletion = typeof storyDeletions.$inferSelect;
export type InsertStoryDeletion = typeof storyDeletions.$inferInsert;

// ============================================================================
// SPONSORS -- replaces the static client/src/lib/sponsors.ts. One row per
// sponsor; per-city eligibility lives in sponsor_cities. sort_order on the
// join row controls the round-robin order within a given city's feed.
// Migration: supabase/migrations/0004_sponsors.sql
// ============================================================================

export const sponsors = pgTable("sponsors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  logoUrl: text("logo_url").notNull(),
  logoAlt: text("logo_alt").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  tagline: text("tagline"),
  href: text("href").notNull(),
  instagram: text("instagram"),
  facebook: text("facebook"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sponsorCities = pgTable(
  "sponsor_cities",
  {
    sponsorId: text("sponsor_id")
      .notNull()
      .references(() => sponsors.id, { onDelete: "cascade" }),
    citySlug: text("city_slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
  },
  (t) => ({
    pk: uniqueIndex("sponsor_cities_pk").on(t.sponsorId, t.citySlug),
    byCity: index("sponsor_cities_city_idx").on(t.citySlug, t.sortOrder),
  }),
);

// ============================================================================
// LEARNING RULES (Phase 9) -- the "AI learns from your edits" loop.
// Migration: supabase/migrations/0006_learning_rules.sql
//
// proposed_rules: drafts surfaced by the pattern scan. Each row carries the
//   evidence that produced it (hit_count, example story IDs) so an admin can
//   audit before approving.
// live_rules: approved rules ingest actually consults via shouldSkipItem().
// ============================================================================

/** Match dimensions a rule can use. */
export const RULE_MATCH_TYPES = [
  "source_name",      // exact match on Source.name
  "source_domain",    // eTLD+1 of Source.url
  "url_regex",        // regex on item.url
  "title_keyword",    // case-insensitive substring in item.title
  "title_regex",      // regex on item.title
] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

/** The same 12 reason codes used for reasoned-delete; mirrored as the
 *  category a rule represents. We re-export the array name so callers
 *  don't have to remember which list to import. */
export const RULE_CATEGORIES = STORY_DELETION_REASONS;
export type RuleCategory = StoryDeletionReason;

export const PROPOSED_RULE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "auto_promoted",
] as const;
export type ProposedRuleStatus = (typeof PROPOSED_RULE_STATUSES)[number];

export const proposedRules = pgTable("proposed_rules", {
  id: serial("id").primaryKey(),
  matchType: text("match_type").$type<RuleMatchType>().notNull(),
  matchValue: text("match_value").notNull(),
  category: text("category").$type<RuleCategory>().notNull(),
  cityId: integer("city_id"),
  hitCount: integer("hit_count").notNull().default(0),
  contradictionCount: integer("contradiction_count").notNull().default(0),
  evidenceWindowDays: integer("evidence_window_days").notNull().default(14),
  exampleStoryIds: integer("example_story_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  status: text("status").$type<ProposedRuleStatus>().notNull().default("pending"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at", { mode: "string", withTimezone: true }),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const liveRules = pgTable("live_rules", {
  id: serial("id").primaryKey(),
  matchType: text("match_type").$type<RuleMatchType>().notNull(),
  matchValue: text("match_value").notNull(),
  category: text("category").$type<RuleCategory>().notNull(),
  cityId: integer("city_id"),
  source: text("source").notNull().default("admin_approved"),
  // Stored as BIGINT in PG but read as a JS number; rule hit counts will
  // never get anywhere near Number.MAX_SAFE_INTEGER.
  hitsLifetime: integer("hits_lifetime").notNull().default(0),
  lastHitAt: timestamp("last_hit_at", { mode: "string", withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  proposedRuleId: integer("proposed_rule_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProposedRule = typeof proposedRules.$inferSelect;
export type InsertProposedRule = typeof proposedRules.$inferInsert;
export type LiveRule = typeof liveRules.$inferSelect;
export type InsertLiveRule = typeof liveRules.$inferInsert;

/** Zod for the admin approve/reject payload. */
export const proposedRuleReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewerNote: z.string().max(500).optional(),
});
export type ProposedRuleReviewInput = z.infer<typeof proposedRuleReviewSchema>;

// ============================================================================
// X (Twitter) API INGEST -- Phase 10
//
// Tweets from a curated Montana list are SIGNALS, not stories. The signal
// processor reads x_tweets, fetches linked article URLs via the HTML
// fetcher (which lands them in the stories table as source_type='x_referred'),
// and the clustering job groups multiple signals into synthesizable
// candidates.
//
// Migrations: 0007_x_ingest.sql, 0008_x_tweets.sql
// ============================================================================

export const xAuthors = pgTable("x_authors", {
  authorId: text("author_id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull().default(""),
  cityId: integer("city_id"),
  outletName: text("outlet_name"),
  isMuted: boolean("is_muted").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const xUnmapped = pgTable("x_unmapped", {
  authorId: text("author_id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull().default(""),
  lastTweetId: text("last_tweet_id"),
  lastTweetText: text("last_tweet_text"),
  seenCount: integer("seen_count").notNull().default(1),
  firstSeen: timestamp("first_seen", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeen: timestamp("last_seen", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const xListCursor = pgTable("x_list_cursor", {
  listId: text("list_id").primaryKey(),
  lastTweetId: text("last_tweet_id"),
  tweetsThisMonth: integer("tweets_this_month").notNull().default(0),
  monthStartedAt: timestamp("month_started_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  lastPolledAt: timestamp("last_polled_at", { mode: "string", withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const xTweets = pgTable("x_tweets", {
  tweetId: text("tweet_id").primaryKey(),
  authorId: text("author_id").notNull(),
  text: text("text").notNull(),
  authorUsername: text("author_username").notNull(),
  linkedUrl: text("linked_url"),
  retweetCount: integer("retweet_count").notNull().default(0),
  replyCount: integer("reply_count").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  quoteCount: integer("quote_count").notNull().default(0),
  impressionCount: integer("impression_count").notNull().default(0),
  cityId: integer("city_id"),
  processed: boolean("processed").notNull().default(false),
  resultedInStoryId: integer("resulted_in_story_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type XAuthor = typeof xAuthors.$inferSelect;
export type InsertXAuthor = typeof xAuthors.$inferInsert;
export type XUnmapped = typeof xUnmapped.$inferSelect;
export type InsertXUnmapped = typeof xUnmapped.$inferInsert;
export type XListCursor = typeof xListCursor.$inferSelect;
export type XTweet = typeof xTweets.$inferSelect;
export type InsertXTweet = typeof xTweets.$inferInsert;

// ============================================================================
// CLUSTERING -- Phase 11. See server/learning/cluster-builder.ts for the
// algorithm. Migration: 0009_clusters.sql
// ============================================================================

export const CLUSTER_VERDICTS = [
  "auto_publish", // synthesizer runs unattended
  "review",       // synthesizer runs but the synth lands in review queue
  "suppress",     // cluster suppressed entirely (wire-service / federal politics)
] as const;
export type ClusterVerdict = (typeof CLUSTER_VERDICTS)[number];

export const clusters = pgTable("clusters", {
  id: serial("id").primaryKey(),
  topicSignature: text("topic_signature").notNull(),
  // bucket_day stored as date string (YYYY-MM-DD) for cross-day uniqueness.
  bucketDay: text("bucket_day").notNull(),
  cityId: integer("city_id"),
  diversityScore: numeric("diversity_score", { precision: 3, scale: 2 }).notNull().default("0"),
  montanaLocality: numeric("montana_locality", { precision: 3, scale: 2 }).notNull().default("0"),
  politicalToxicity: numeric("political_toxicity", { precision: 3, scale: 2 }).notNull().default("0"),
  distinctAuthors: integer("distinct_authors").notNull().default(0),
  verdict: text("verdict").$type<ClusterVerdict>().notNull().default("review"),
  verdictReason: text("verdict_reason"),
  synthesisStoryId: integer("synthesis_story_id"),
  firstSeenAt: timestamp("first_seen_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clusterMembers = pgTable("cluster_members", {
  clusterId: integer("cluster_id").notNull(),
  refType: text("ref_type").notNull(), // 'story' | 'x_tweet'
  refId: text("ref_id").notNull(),
  authorKey: text("author_key").notNull(),
  addedAt: timestamp("added_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Cluster = typeof clusters.$inferSelect;
export type InsertCluster = typeof clusters.$inferInsert;
export type ClusterMember = typeof clusterMembers.$inferSelect;
export type InsertClusterMember = typeof clusterMembers.$inferInsert;

// ============================================================================
// SYNTHESIS QUEUE -- Phase 12. Holds Gemini-written drafts whose cluster
// verdict was 'review'. Auto-publish clusters skip the queue and write
// directly to stories. Migration: 0010_synthesis.sql
// ============================================================================

export const SYNTHESIS_STATUSES = [
  "pending",   // waiting on admin review
  "approved",  // admin clicked approve; story_id is set on stories row
  "rejected",  // admin clicked reject; cluster gets verdict=suppress
  "published", // auto_publish path; landed in stories without ever sitting here
] as const;
export type SynthesisStatus = (typeof SYNTHESIS_STATUSES)[number];

export const synthesisQueue = pgTable("synthesis_queue", {
  id: serial("id").primaryKey(),
  clusterId: integer("cluster_id").notNull().unique(),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  desk: text("desk").notNull(),
  cityId: integer("city_id"),
  model: text("model").notNull().default("gemini-1.5-flash"),
  sourceStoryIds: integer("source_story_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  status: text("status").$type<SynthesisStatus>().notNull().default("pending"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at", { mode: "string", withTimezone: true }),
  reviewerNote: text("reviewer_note"),
  clusterDiversity: numeric("cluster_diversity", { precision: 3, scale: 2 }),
  clusterMontana: numeric("cluster_montana", { precision: 3, scale: 2 }),
  clusterPolitics: numeric("cluster_politics", { precision: 3, scale: 2 }),
  clusterAuthors: integer("cluster_authors"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SynthesisDraft = typeof synthesisQueue.$inferSelect;
export type InsertSynthesisDraft = typeof synthesisQueue.$inferInsert;

/** Zod for admin synthesis review payload. */
export const synthesisReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewerNote: z.string().max(500).optional(),
  // Optionally override the headline / body before approving.
  headline: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(3000).optional(),
});
export type SynthesisReviewInput = z.infer<typeof synthesisReviewSchema>;

// Quarantine for events that fail strict start-time validation. Surfaced
// in /admin/event-quarantine so a human can release or reject. We never
// let a bad start-time leak into the public calendar.
export const EVENT_QUARANTINE_STATUSES = [
  "pending",   // sitting in queue waiting for review
  "released", // admin approved -> moved to events with a corrected time
  "rejected", // admin discarded
] as const;
export type EventQuarantineStatus = (typeof EVENT_QUARANTINE_STATUSES)[number];

export const eventQuarantine = pgTable("event_quarantine", {
  id: serial("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  sourceName: text("source_name").notNull(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  venue: text("venue"),
  rawTimeText: text("raw_time_text"),
  candidateStartsAt: timestamp("candidate_starts_at", { mode: "string", withTimezone: true }),
  cityId: integer("city_id"),
  reason: text("reason").notNull(),
  status: text("status").$type<EventQuarantineStatus>().notNull().default("pending"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at", { mode: "string", withTimezone: true }),
  reviewerNote: text("reviewer_note"),
  releasedStoryId: integer("released_story_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export type EventQuarantineRow = typeof eventQuarantine.$inferSelect;
export type InsertEventQuarantine = typeof eventQuarantine.$inferInsert;

/** Admin review payload for /api/admin/event-quarantine/:id. */
export const eventQuarantineReviewSchema = z.object({
  action: z.enum(["release", "reject"]),
  reviewerNote: z.string().max(500).optional(),
  // When releasing, admin can supply a corrected ISO start time.
  correctedStartsAt: z.string().min(1).max(40).optional(),
  correctedDesk: z.string().min(1).max(40).optional(),
});
export type EventQuarantineReviewInput = z.infer<typeof eventQuarantineReviewSchema>;

export type Sponsor = typeof sponsors.$inferSelect;
export type InsertSponsor = typeof sponsors.$inferInsert;
export type SponsorCity = typeof sponsorCities.$inferSelect;
export type InsertSponsorCity = typeof sponsorCities.$inferInsert;

// Shape returned by /api/sponsors -- a sponsor row plus its city eligibility
// list, so the client doesn't need a second round-trip.
export interface SponsorWithCities extends Sponsor {
  cities: { citySlug: string; sortOrder: number }[];
}

// Zod for admin edit payload. All fields optional so a PATCH can update any
// subset; cities is the FULL desired eligibility list (sets, not deltas).
export const sponsorEditSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  logoUrl: z.string().min(1).max(500).optional(),
  logoAlt: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(50).optional(),
  tagline: z.string().max(200).nullable().optional(),
  href: z.string().url().max(2048).optional(),
  instagram: z.string().url().max(2048).nullable().optional(),
  facebook: z.string().url().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
  cities: z
    .array(
      z.object({
        citySlug: z.string().min(1).max(50),
        sortOrder: z.number().int().min(0).max(10_000),
      }),
    )
    .optional(),
});
export type SponsorEditInput = z.infer<typeof sponsorEditSchema>;
