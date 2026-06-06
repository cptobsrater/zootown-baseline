import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Desk identifiers — EXACT ORDER matters for UI tabs
export const DESKS = [
  "city",
  "business",
  "crime",
  "sports",
  "health",
  "events",
  "politics",
  "people",
  "history",
  "science_tech",
] as const;
export type Desk = (typeof DESKS)[number];

// Political scope — only applies to desk = "politics"
export const POLITICAL_SCOPES = ["local", "state", "national"] as const;
export type PoliticalScope = (typeof POLITICAL_SCOPES)[number];

// Source types (legacy free-form label, kept for story attribution)
export const SOURCE_TYPES = ["Official", "Local News", "Community Calendar", "Social Media"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// Top-level source category — used for grouping in the Sources dialog
export const SOURCE_CATEGORIES = ["official", "news", "calendars", "social"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

// Status chip labels
export const STATUS = ["New", "Updated", "Event", "Developing"] as const;
export type Status = (typeof STATUS)[number];

// Risk levels (drives human-in-the-loop review queue)
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// Moderation states
export const MOD_STATE = ["draft", "approved", "rejected"] as const;
export type ModState = (typeof MOD_STATE)[number];

export const stories = sqliteTable("stories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters"),
  desk: text("desk").notNull(), // city | business | crime | sports | health | events | politics | people | history | science_tech
  tags: text("tags").notNull(), // JSON string[]
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  publishedAt: text("published_at").notNull(), // ISO string
  fetchedAt: text("fetched_at").notNull(),    // ISO string
  location: text("location"), // e.g. "Downtown Missoula"
  status: text("status"),     // New | Updated | Event | Developing
  riskLevel: text("risk_level").notNull().default("low"),
  isSeeded: integer("is_seeded", { mode: "boolean" }).notNull().default(true),
  modState: text("mod_state").notNull().default("approved"),
  politicalScope: text("political_scope"), // local | state | national — only set when desk === "politics"
  eventDate: text("event_date"), // ISO string — set when desk === "events"
});

export const insertStorySchema = createInsertSchema(stories).omit({ id: true });
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof stories.$inferSelect;

// Upcoming events for the right rail
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  venue: text("venue").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  tag: text("tag"),
  desk: text("desk"),
  description: text("description"),
});

export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EventItem = typeof events.$inferSelect;

// History stories pool — curated, rotated weekly
export const historyStories = sqliteTable("history_stories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(), // markdown body — full story
  sourceUrl: text("source_url"), // optional — Wikipedia or official archive link
  publishedAt: text("published_at").notNull(), // ISO — set when added to pool
  lastBumpedAt: text("last_bumped_at").notNull(), // ISO — updates when republished
});

export const insertHistoryStorySchema = createInsertSchema(historyStories).omit({ id: true });
export type InsertHistoryStory = z.infer<typeof insertHistoryStorySchema>;
export type HistoryStory = typeof historyStories.$inferSelect;

// Community-posted jobs — Craigslist-style, admin-moderated
export const JOB_POST_STATES = ["pending", "approved", "rejected"] as const;
export type JobPostState = (typeof JOB_POST_STATES)[number];

export const jobPosts = sqliteTable("job_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),                // job title
  business: text("business").notNull(),          // employer / business name
  address: text("address"),                      // optional
  phone: text("phone"),                          // optional
  pay: text("pay"),                              // optional, free-form ("$18/hr", "DOE")
  body: text("body").notNull(),                  // free-form description, up to ~1000 words
  submitterEmail: text("submitter_email"),       // optional contact for moderator
  state: text("state").$type<JobPostState>().notNull().default("pending"),
  submittedAt: text("submitted_at").notNull(),   // ISO
  approvedAt: text("approved_at"),               // ISO when admin approves
});

export const insertJobPostSchema = createInsertSchema(jobPosts).omit({
  id: true,
  state: true,
  submittedAt: true,
  approvedAt: true,
});
export type InsertJobPost = z.infer<typeof insertJobPostSchema>;
export type JobPost = typeof jobPosts.$inferSelect;

// Feed types supported by the ingestion pipeline
export const FEED_TYPES = ["rss", "atom", "html", "headless", "none"] as const;
export type FeedType = (typeof FEED_TYPES)[number];

// Run modes — live fetch vs fixtures fallback
export const INGEST_MODES = ["live", "mock", "mixed"] as const;
export type IngestMode = (typeof INGEST_MODES)[number];

// Source health
export const SOURCE_STATUS = ["ok", "stale", "error", "idle"] as const;
export type SourceStatus = (typeof SOURCE_STATUS)[number];

// Watched sources (for the Sources drawer + ingestion scheduler)
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),                 // homepage / canonical
  feedUrl: text("feed_url"),                   // RSS/Atom URL or scrape target
  feedType: text("feed_type").notNull().default("none"), // rss | atom | html | none
  parserKey: text("parser_key"),               // for html sources: which parser module to use
  sourceType: text("source_type").notNull(),
  desks: text("desks").notNull(), // JSON string[] of desk ids
  categoryPriority: text("category_priority"), // JSON string[] of desk ids ordered by likelihood
  cadenceMinutes: integer("cadence_minutes").notNull().default(5),
  lastCheckedAt: text("last_checked_at"),
  lastStatus: text("last_status").notNull().default("idle"), // ok | stale | error | idle
  lastMode: text("last_mode"),                 // live | mock | mixed
  lastError: text("last_error"),
  lastItems: integer("last_items").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  category: text("category").notNull().default("official"), // official | news | calendars | social
  handle: text("handle"), // @-handle for social media sources
  platform: text("platform"), // x | facebook | instagram | youtube — null for non-social
});

export const insertSourceSchema = createInsertSchema(sources).omit({ id: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sources.$inferSelect;

// Ingestion run log
export const ingestRuns = sqliteTable("ingest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull(),
  sourceName: text("source_name").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  mode: text("mode").notNull(),          // live | mock | mixed
  fetched: integer("fetched").notNull().default(0),
  added: integer("added").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  clustered: integer("clustered").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  message: text("message"),
});

export type IngestRun = typeof ingestRuns.$inferSelect;

// Join table — lets one story have multiple source attributions (cross-source clustering)
export const storySources = sqliteTable("story_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storyId: integer("story_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  addedAt: text("added_at").notNull(),
});

export type StorySource = typeof storySources.$inferSelect;

// Manual edit log
export const storyEdits = sqliteTable("story_edits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storyId: integer("story_id").notNull(),
  field: text("field").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  sourceName: text("source_name"),
  editedAt: text("edited_at").notNull(),
});

export type StoryEdit = typeof storyEdits.$inferSelect;

// Meta key-value store for flags (backfill_v2, history_last_rotation, etc.)
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
