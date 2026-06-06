import { stories, events, sources, ingestRuns, storySources, storyEdits, historyStories, meta } from "@shared/schema";
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
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, asc, and, gte, or, isNull, sql } from "drizzle-orm";
import { SEED_STORIES, SEED_EVENTS, SEED_SOURCES } from "./seed";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = path.resolve(process.cwd(), "data.db");
console.log(`[storage] opening sqlite at ${DB_PATH} (exists=${fs.existsSync(DB_PATH)})`);
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
console.log(`[storage] sqlite opened OK`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_matters TEXT,
  desk TEXT NOT NULL,
  tags TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  published_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  location TEXT,
  status TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  is_seeded INTEGER NOT NULL DEFAULT 1,
  mod_state TEXT NOT NULL DEFAULT 'approved'
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  tag TEXT
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  feed_url TEXT,
  feed_type TEXT NOT NULL DEFAULT 'none',
  parser_key TEXT,
  source_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'official',
  handle TEXT,
  platform TEXT,
  desks TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL DEFAULT 5,
  last_checked_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_mode TEXT,
  last_error TEXT,
  last_items INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  clustered INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE TABLE IF NOT EXISTS story_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  source_name TEXT,
  edited_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  published_at TEXT NOT NULL,
  last_bumped_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  business TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  pay TEXT,
  body TEXT NOT NULL,
  submitter_email TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_posts_state ON job_posts(state);
CREATE INDEX IF NOT EXISTS idx_job_posts_submitted_at ON job_posts(submitted_at);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_source_url ON stories(source_url);
CREATE INDEX IF NOT EXISTS idx_stories_published_at ON stories(published_at);
CREATE INDEX IF NOT EXISTS idx_story_sources_story_id ON story_sources(story_id);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_started ON ingest_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_story_edits_story_id ON story_edits(story_id);
CREATE INDEX IF NOT EXISTS idx_story_edits_edited_at ON story_edits(edited_at);
`);

function ensureColumn(table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[storage] migration: added ${table}.${column}`);
  }
}

// Stories migrations
ensureColumn("stories", "political_scope", "political_scope TEXT");
ensureColumn("stories", "event_date", "event_date TEXT");

// Events migrations
ensureColumn("events", "ends_at", "ends_at TEXT");
ensureColumn("events", "desk", "desk TEXT");
ensureColumn("events", "description", "description TEXT");

// Sources migrations
ensureColumn("sources", "feed_url", "feed_url TEXT");
ensureColumn("sources", "feed_type", "feed_type TEXT NOT NULL DEFAULT 'none'");
ensureColumn("sources", "parser_key", "parser_key TEXT");
ensureColumn("sources", "last_status", "last_status TEXT NOT NULL DEFAULT 'idle'");
ensureColumn("sources", "last_mode", "last_mode TEXT");
ensureColumn("sources", "last_error", "last_error TEXT");
ensureColumn("sources", "last_items", "last_items INTEGER NOT NULL DEFAULT 0");
ensureColumn("sources", "category", "category TEXT NOT NULL DEFAULT 'official'");
ensureColumn("sources", "handle", "handle TEXT");
ensureColumn("sources", "platform", "platform TEXT");
ensureColumn("sources", "category_priority", "category_priority TEXT");

export const db = drizzle(sqlite);

// ------ Seeding (runs if empty) ------
function seedIfEmpty() {
  const row = sqlite.prepare("SELECT COUNT(*) as c FROM stories").get() as { c: number };
  if (row.c === 0) {
    const now = Date.now();
    const insertStmts = db;

    for (const s of SEED_STORIES) {
      const publishedAt = new Date(now - s.minutesAgo * 60 * 1000).toISOString();
      const fetchedAt = new Date(now - Math.max(0, s.minutesAgo - 2) * 60 * 1000).toISOString();
      insertStmts
        .insert(stories)
        .values({
          headline: s.headline,
          summary: s.summary,
          whyItMatters: s.whyItMatters ?? null,
          desk: s.desk,
          tags: JSON.stringify(s.tags),
          sourceName: s.sourceName,
          sourceUrl: s.sourceUrl,
          sourceType: s.sourceType,
          publishedAt,
          fetchedAt,
          location: s.location ?? null,
          status: s.status ?? null,
          riskLevel: s.riskLevel,
          isSeeded: s.isSeeded,
          modState: s.modState,
          politicalScope: null,
          eventDate: null,
        })
        .run();
    }

    for (const e of SEED_EVENTS) {
      const startsAt = new Date(now + e.hoursFromNow * 3600 * 1000).toISOString();
      insertStmts
        .insert(events)
        .values({
          title: e.title,
          venue: e.venue,
          startsAt,
          endsAt: null,
          sourceName: e.sourceName,
          sourceUrl: e.sourceUrl,
          tag: e.tag ?? null,
          desk: e.desk ?? null,
          description: e.description ?? null,
        })
        .run();
    }

    for (const src of SEED_SOURCES) {
      insertStmts.insert(sources).values(src).run();
    }
  }
}

seedIfEmpty();

// ------ One-shot v2 backfill ------
// Re-classify stories using the new predictor (culture/community → events/people/city/etc).
// Idempotent: only runs if meta.backfilled_v2 is missing.
function backfillV2IfNeeded() {
  try {
    sqlite.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    const existing = sqlite.prepare("SELECT value FROM meta WHERE key = 'backfilled_v2'").get() as { value: string } | undefined;
    if (existing) {
      console.log(`[backfill-v2] already done at ${existing.value}, skipping`);
      return;
    }
    console.log("[backfill-v2] starting…");

    const remap = (desk: string, headline: string, summary: string): string => {
      const text = (headline + " " + summary).toLowerCase();
      if (desk === "culture") {
        if (/festival|concert|live music|open mic|art opening|gallery|performance|tickets|doors open|free event|rsvp|this weekend|tonight/.test(text)) return "events";
        if (/profile|interview|q&a|born and raised|artist|musician|author|poet|filmmaker/.test(text)) return "people";
        if (/business|restaurant|cafe|brewery|shop|store|opens|opening/.test(text)) return "business";
        return "events";
      }
      if (desk === "community") {
        if (/volunteer|hero|neighbor|good samaritan|profile|interview|story of|meet/.test(text)) return "people";
        return "city";
      }
      return desk;
    };
    const VALID = new Set(["city", "business", "crime", "sports", "health", "events", "politics", "people", "history", "science_tech"]);

    const rows = sqlite.prepare("SELECT id, desk, headline, summary FROM stories").all() as Array<{ id: number; desk: string; headline: string; summary: string }>;
    let changed = 0;
    const upd = sqlite.prepare("UPDATE stories SET desk = ? WHERE id = ?");
    const tx = sqlite.transaction(() => {
      for (const r of rows) {
        let next = r.desk;
        if (!VALID.has(r.desk)) next = remap(r.desk, r.headline || "", r.summary || "");
        if (next !== r.desk) {
          upd.run(next, r.id);
          changed++;
        }
      }
    });
    tx();
    sqlite.prepare("INSERT INTO meta (key, value) VALUES ('backfilled_v2', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    console.log(`[backfill-v2] done — reclassified ${changed} of ${rows.length} stories`);
  } catch (err) {
    console.error("[backfill-v2] failed (non-fatal):", err);
  }
}
backfillV2IfNeeded();

// ------ Storage interface ------

export interface StoryQuery {
  desk?: string;
  q?: string;
  limit?: number;
  cursor?: number;
  modState?: ModState | "all";
}

export interface IStorage {
  listStories(q: StoryQuery): { items: Story[]; nextCursor: number | null; total: number };
  getStory(id: number): Story | undefined;
  createStory(input: InsertStory): Story;
  updateStoryModState(id: number, modState: ModState): Story | undefined;
  listEvents(limit?: number): EventItem[];
  findEventByUrl(url: string): EventItem | undefined;
  createEvent(input: InsertEvent): EventItem;
  listSources(): Source[];
  getPublishedCounts(): Map<string, number>;
  getSource(id: number): Source | undefined;
  updateSourceHealth(
    id: number,
    fields: { lastCheckedAt: string; lastStatus: string; lastMode: string | null; lastError: string | null; lastItems: number },
  ): void;
  findStoryByCanonicalUrl(canonicalUrl: string): Story | undefined;
  findClusterCandidate(title: string, withinMs: number): Story | undefined;
  attachStorySource(storyId: number, input: { sourceName: string; sourceUrl: string; sourceType: string }): StorySource;
  listStorySources(storyId: number): StorySource[];
  countStorySources(storyId: number): number;
  recordIngestRun(run: Omit<IngestRun, "id">): IngestRun;
  listIngestRuns(limit?: number): IngestRun[];
  getTrendingTags(limit?: number): Array<{ tag: string; count: number }>;
  getTopStories(limit?: number): Story[];
  updateStoryFields(id: number, fields: Partial<Pick<Story, "headline" | "summary" | "desk" | "sourceUrl">>): Story | undefined;
  deleteStory(id: number): boolean;
  logEdit(edit: Omit<StoryEdit, "id">): StoryEdit;
  listEdits(limit?: number): StoryEdit[];
  recentEditPatterns(days?: number): Array<{ sourceName: string; field: string; count: number }>;
  createSource(input: InsertSource): Source;
  deleteSource(id: number): boolean;
  updateSourceCategoryPriority(id: number, categoryPriority: string[]): void;
  // History stories
  listHistoryStories(): HistoryStory[];
  createHistoryStory(input: InsertHistoryStory): HistoryStory;
  bumpOldestHistoryStory(): void;
  countHistoryStories(): number;
  deleteHistoryStoryById(id: number): void;
  // Job posts (community-submitted, admin-moderated)
  listJobPosts(state?: JobPostState): JobPost[];
  getJobPost(id: number): JobPost | null;
  createJobPost(input: InsertJobPost): JobPost;
  setJobPostState(id: number, state: JobPostState): JobPost | null;
  deleteJobPost(id: number): boolean;
  countJobPosts(state?: JobPostState): number;
  // Meta flags
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
}

export class DatabaseStorage implements IStorage {
  listStories(q: StoryQuery) {
    const limit = q.limit ?? 20;
    const cursor = q.cursor ?? 0;
    const modState = q.modState ?? "approved";

    const where: string[] = [];
    const params: any[] = [];

    if (modState !== "all") {
      where.push("mod_state = ?");
      params.push(modState);
    }
    if (q.desk && q.desk !== "all") {
      where.push("desk = ?");
      params.push(q.desk);
    }
    if (q.q && q.q.trim()) {
      const needle = `%${q.q.trim().toLowerCase()}%`;
      where.push("(lower(headline) LIKE ? OR lower(summary) LIKE ? OR lower(tags) LIKE ? OR lower(location) LIKE ?)");
      params.push(needle, needle, needle, needle);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM stories ${whereSql}`)
      .get(...params) as { c: number };

    const rows = sqlite
      .prepare(
        `SELECT * FROM stories ${whereSql} ORDER BY published_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, cursor) as any[];

    const items: Story[] = rows.map(rowToStory);
    const nextCursor = cursor + items.length < totalRow.c ? cursor + items.length : null;
    return { items, nextCursor, total: totalRow.c };
  }

  getStory(id: number) {
    const row = sqlite.prepare(`SELECT * FROM stories WHERE id = ? LIMIT 1`).get(id) as any;
    return row ? rowToStory(row) : undefined;
  }

  createStory(input: InsertStory) {
    return db.insert(stories).values(input).returning().get();
  }

  updateStoryModState(id: number, modState: ModState) {
    sqlite.prepare("UPDATE stories SET mod_state = ? WHERE id = ?").run(modState, id);
    return this.getStory(id);
  }

  listEvents(limit = 6) {
    // Only return events that haven't ended yet. Use endsAt when present, else fall back to startsAt.
    const nowIso = new Date().toISOString();
    return db
      .select()
      .from(events)
      .where(or(gte(events.endsAt, nowIso), and(isNull(events.endsAt), gte(events.startsAt, nowIso))))
      .orderBy(asc(events.startsAt))
      .limit(limit)
      .all();
  }

  findEventByUrl(url: string): EventItem | undefined {
    return db.select().from(events).where(eq(events.sourceUrl, url)).get();
  }

  createEvent(input: InsertEvent): EventItem {
    return db.insert(events).values(input).returning().get();
  }

  listSources() {
    return db.select().from(sources).orderBy(asc(sources.name)).all();
  }

  getPublishedCounts(): Map<string, number> {
    const rows = sqlite
      .prepare(
        `SELECT lower(source_name) AS name, COUNT(*) AS c FROM stories WHERE mod_state = 'approved' GROUP BY lower(source_name)`,
      )
      .all() as Array<{ name: string; c: number }>;
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.name, r.c);
    return map;
  }

  getSource(id: number) {
    return db.select().from(sources).where(eq(sources.id, id)).get();
  }

  updateSourceHealth(
    id: number,
    fields: { lastCheckedAt: string; lastStatus: string; lastMode: string | null; lastError: string | null; lastItems: number },
  ) {
    sqlite
      .prepare(
        `UPDATE sources SET last_checked_at = ?, last_status = ?, last_mode = ?, last_error = ?, last_items = ? WHERE id = ?`,
      )
      .run(fields.lastCheckedAt, fields.lastStatus, fields.lastMode, fields.lastError, fields.lastItems, id);
  }

  findStoryByCanonicalUrl(canonicalUrl: string) {
    const direct = sqlite
      .prepare(`SELECT * FROM stories WHERE source_url = ? LIMIT 1`)
      .get(canonicalUrl) as any;
    if (direct) return rowToStory(direct);
    const via = sqlite
      .prepare(
        `SELECT stories.* FROM story_sources
         JOIN stories ON stories.id = story_sources.story_id
         WHERE story_sources.source_url = ? LIMIT 1`,
      )
      .get(canonicalUrl) as any;
    return via ? rowToStory(via) : undefined;
  }

  findClusterCandidate(title: string, withinMs: number) {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const rows = sqlite
      .prepare(
        `SELECT * FROM stories WHERE mod_state = 'approved' AND published_at > ? ORDER BY published_at DESC LIMIT 120`,
      )
      .all(cutoff) as any[];
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

  attachStorySource(storyId: number, input: { sourceName: string; sourceUrl: string; sourceType: string }) {
    const existing = sqlite
      .prepare(`SELECT * FROM story_sources WHERE story_id = ? AND source_url = ? LIMIT 1`)
      .get(storyId, input.sourceUrl) as any;
    if (existing) return rowToStorySource(existing);
    const addedAt = new Date().toISOString();
    const res = sqlite
      .prepare(
        `INSERT INTO story_sources (story_id, source_name, source_url, source_type, added_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(storyId, input.sourceName, input.sourceUrl, input.sourceType, addedAt);
    return {
      id: Number(res.lastInsertRowid),
      storyId,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      addedAt,
    };
  }

  listStorySources(storyId: number) {
    const rows = sqlite
      .prepare(`SELECT * FROM story_sources WHERE story_id = ? ORDER BY added_at ASC`)
      .all(storyId) as any[];
    return rows.map(rowToStorySource);
  }

  countStorySources(storyId: number) {
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM story_sources WHERE story_id = ?`)
      .get(storyId) as { c: number };
    return row.c;
  }

  recordIngestRun(run: Omit<IngestRun, "id">) {
    const res = sqlite
      .prepare(
        `INSERT INTO ingest_runs (source_id, source_name, started_at, finished_at, mode, fetched, added, duplicates, clustered, errors, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.sourceId,
        run.sourceName,
        run.startedAt,
        run.finishedAt,
        run.mode,
        run.fetched,
        run.added,
        run.duplicates,
        run.clustered,
        run.errors,
        run.message ?? null,
      );
    return { id: Number(res.lastInsertRowid), ...run };
  }

  listIngestRuns(limit = 40) {
    const rows = sqlite
      .prepare(`SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map(rowToIngestRun);
  }

  getTrendingTags(limit = 10) {
    const rows = sqlite
      .prepare(
        `SELECT tags FROM stories WHERE mod_state = 'approved' ORDER BY published_at DESC LIMIT 80`
      )
      .all() as Array<{ tags: string }>;
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

  updateStoryFields(
    id: number,
    fields: Partial<Pick<Story, "headline" | "summary" | "desk" | "sourceUrl">>,
  ): Story | undefined {
    const sets: string[] = [];
    const vals: any[] = [];
    if (fields.headline !== undefined) { sets.push("headline = ?"); vals.push(fields.headline); }
    if (fields.summary !== undefined) { sets.push("summary = ?"); vals.push(fields.summary); }
    if (fields.desk !== undefined) { sets.push("desk = ?"); vals.push(fields.desk); }
    if (fields.sourceUrl !== undefined) { sets.push("source_url = ?"); vals.push(fields.sourceUrl); }
    if (sets.length === 0) return this.getStory(id);
    vals.push(id);
    sqlite.prepare(`UPDATE stories SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return this.getStory(id);
  }

  deleteStory(id: number): boolean {
    sqlite.prepare(`DELETE FROM story_sources WHERE story_id = ?`).run(id);
    const res = sqlite.prepare(`DELETE FROM stories WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  logEdit(edit: Omit<StoryEdit, "id">): StoryEdit {
    const res = sqlite
      .prepare(
        `INSERT INTO story_edits (story_id, field, before_value, after_value, source_name, edited_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(edit.storyId, edit.field, edit.beforeValue ?? null, edit.afterValue ?? null, edit.sourceName ?? null, edit.editedAt);
    return { id: Number(res.lastInsertRowid), ...edit };
  }

  listEdits(limit = 100): StoryEdit[] {
    const rows = sqlite
      .prepare(`SELECT * FROM story_edits ORDER BY edited_at DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map(rowToStoryEdit);
  }

  recentEditPatterns(days = 7): Array<{ sourceName: string; field: string; count: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const rows = sqlite
      .prepare(
        `SELECT source_name, field, COUNT(*) AS c FROM story_edits
         WHERE edited_at > ? AND source_name IS NOT NULL
         GROUP BY source_name, field
         ORDER BY c DESC
         LIMIT 20`,
      )
      .all(cutoff) as Array<{ source_name: string; field: string; c: number }>;
    return rows.map((r) => ({ sourceName: r.source_name, field: r.field, count: r.c }));
  }

  createSource(input: InsertSource): Source {
    return db.insert(sources).values(input).returning().get();
  }

  deleteSource(id: number): boolean {
    const res = sqlite.prepare(`DELETE FROM sources WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  updateSourceCategoryPriority(id: number, categoryPriority: string[]): void {
    sqlite
      .prepare(`UPDATE sources SET category_priority = ? WHERE id = ?`)
      .run(JSON.stringify(categoryPriority), id);
  }

  getTopStories(limit = 6) {
    // One story per desk, prefer recent + higher-risk. We pull a wider window
    // (2 weeks) so smaller desks still surface, then dedupe to one per desk.
    const now = Date.now();
    const windowStart = new Date(now - 14 * 24 * 3600 * 1000).toISOString();
    const rows = sqlite
      .prepare(
        `SELECT * FROM stories
         WHERE mod_state = 'approved' AND published_at > ?
         ORDER BY
           CASE risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
           published_at DESC`
      )
      .all(windowStart) as any[];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows) {
      const desk = r.desk as string | null;
      if (!desk) continue;
      if (seen.has(desk)) continue;
      seen.add(desk);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out.map(rowToStory);
  }

  // History stories
  listHistoryStories(): HistoryStory[] {
    const rows = sqlite
      .prepare(`SELECT * FROM history_stories ORDER BY last_bumped_at DESC`)
      .all() as any[];
    return rows.map(rowToHistoryStory);
  }

  createHistoryStory(input: InsertHistoryStory): HistoryStory {
    const res = sqlite
      .prepare(
        `INSERT INTO history_stories (headline, summary, source_url, published_at, last_bumped_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.headline, input.summary, input.sourceUrl ?? null, input.publishedAt, input.lastBumpedAt);
    const row = sqlite.prepare(`SELECT * FROM history_stories WHERE id = ?`).get(Number(res.lastInsertRowid)) as any;
    return rowToHistoryStory(row);
  }

  bumpOldestHistoryStory(): void {
    const oldest = sqlite
      .prepare(`SELECT id FROM history_stories ORDER BY last_bumped_at ASC LIMIT 1`)
      .get() as { id: number } | undefined;
    if (!oldest) return;
    const now = new Date().toISOString();
    sqlite.prepare(`UPDATE history_stories SET last_bumped_at = ? WHERE id = ?`).run(now, oldest.id);
  }

  countHistoryStories(): number {
    const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM history_stories`).get() as { c: number };
    return row.c;
  }

  // Meta
  getMeta(key: string): string | null {
    const row = sqlite.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    sqlite
      .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  deleteHistoryStoryById(id: number): void {
    sqlite.prepare("DELETE FROM history_stories WHERE id = ?").run(id);
  }

  // ----- Job posts -----
  listJobPosts(state?: JobPostState): JobPost[] {
    const rows = state
      ? (sqlite
          .prepare(`SELECT * FROM job_posts WHERE state = ? ORDER BY submitted_at DESC`)
          .all(state) as any[])
      : (sqlite
          .prepare(`SELECT * FROM job_posts ORDER BY submitted_at DESC`)
          .all() as any[]);
    return rows.map(rowToJobPost);
  }

  getJobPost(id: number): JobPost | null {
    const row = sqlite.prepare(`SELECT * FROM job_posts WHERE id = ?`).get(id) as any;
    return row ? rowToJobPost(row) : null;
  }

  createJobPost(input: InsertJobPost): JobPost {
    const submittedAt = new Date().toISOString();
    const res = sqlite
      .prepare(
        `INSERT INTO job_posts (title, business, address, phone, pay, body, submitter_email, state, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        input.title.trim(),
        input.business.trim(),
        input.address?.trim() || null,
        input.phone?.trim() || null,
        input.pay?.trim() || null,
        input.body.trim(),
        input.submitterEmail?.trim() || null,
        submittedAt,
      );
    const row = sqlite.prepare(`SELECT * FROM job_posts WHERE id = ?`).get(Number(res.lastInsertRowid)) as any;
    return rowToJobPost(row);
  }

  setJobPostState(id: number, state: JobPostState): JobPost | null {
    const approvedAt = state === "approved" ? new Date().toISOString() : null;
    sqlite
      .prepare(`UPDATE job_posts SET state = ?, approved_at = COALESCE(?, approved_at) WHERE id = ?`)
      .run(state, approvedAt, id);
    return this.getJobPost(id);
  }

  deleteJobPost(id: number): boolean {
    const res = sqlite.prepare(`DELETE FROM job_posts WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  countJobPosts(state?: JobPostState): number {
    const row = state
      ? (sqlite.prepare(`SELECT COUNT(*) AS c FROM job_posts WHERE state = ?`).get(state) as { c: number })
      : (sqlite.prepare(`SELECT COUNT(*) AS c FROM job_posts`).get() as { c: number });
    return row.c;
  }
}

function rowToJobPost(row: any): JobPost {
  return {
    id: row.id,
    title: row.title,
    business: row.business,
    address: row.address,
    phone: row.phone,
    pay: row.pay,
    body: row.body,
    submitterEmail: row.submitter_email,
    state: row.state,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
  };
}

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

function rowToIngestRun(r: any): IngestRun {
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceName: r.source_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    mode: r.mode,
    fetched: r.fetched,
    added: r.added,
    duplicates: r.duplicates,
    clustered: r.clustered,
    errors: r.errors,
    message: r.message,
  };
}

function rowToStoryEdit(r: any): StoryEdit {
  return {
    id: r.id,
    storyId: r.story_id,
    field: r.field,
    beforeValue: r.before_value,
    afterValue: r.after_value,
    sourceName: r.source_name,
    editedAt: r.edited_at,
  };
}

function rowToStorySource(r: any): StorySource {
  return {
    id: r.id,
    storyId: r.story_id,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
    addedAt: r.added_at,
  };
}

function rowToStory(r: any): Story {
  return {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    desk: r.desk,
    tags: r.tags,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at,
    location: r.location,
    status: r.status,
    riskLevel: r.risk_level,
    isSeeded: !!r.is_seeded,
    modState: r.mod_state,
    politicalScope: r.political_scope ?? null,
    eventDate: r.event_date ?? null,
  };
}

function rowToHistoryStory(r: any): HistoryStory {
  return {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    sourceUrl: r.source_url ?? null,
    publishedAt: r.published_at,
    lastBumpedAt: r.last_bumped_at,
  };
}

export const storage = new DatabaseStorage();
