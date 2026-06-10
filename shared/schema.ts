import { pgTable, text, integer, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Desk identifiers — EXACT ORDER matters for UI tabs
export const DESKS = ["city", "business", "crime", "sports", "health", "events", "people", "history"] as const;
export type Desk = (typeof DESKS)[number];
export const RETIRED_DESKS = ["politics", "science_tech"] as const;
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
