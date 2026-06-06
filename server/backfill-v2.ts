/**
 * One-shot backfill: re-classifies all existing stories using the new predictor.
 * Migrates culture → events/people/business, community → city/people.
 * Sets meta.backfilled_v2 flag when complete.
 * Run via: npx tsx server/backfill-v2.ts
 */
import "../server/storage"; // ensure DB opened
import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "data.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Check if already backfilled
const existing = sqlite.prepare("SELECT value FROM meta WHERE key = 'backfilled_v2'").get() as { value: string } | undefined;
if (existing) {
  console.log("[backfill-v2] already done, skipping");
  sqlite.close();
  process.exit(0);
}

// Map old culture/community stories to new desks based on content
function remapOldDesk(desk: string, headline: string, summary: string): string {
  const text = (headline + " " + summary).toLowerCase();

  if (desk === "culture") {
    // Event-like content → events
    if (/festival|concert|live music|open mic|art opening|gallery|performance|tickets|doors open|free event|rsvp|this weekend|tonight/.test(text)) {
      return "events";
    }
    // People-like content → people
    if (/profile|interview|q&a|born and raised|artist|musician|author|poet|filmmaker/.test(text)) {
      return "people";
    }
    // Business-like → business
    if (/business|restaurant|cafe|brewery|shop|store|opens|opening/.test(text)) {
      return "business";
    }
    // Default culture → events
    return "events";
  }

  if (desk === "community") {
    // People-like → people
    if (/volunteer|person|hero|neighbor|good samaritan|profile|interview|story of|meet/.test(text)) {
      return "people";
    }
    // Default community → city
    return "city";
  }

  // Remove history from auto-classifier — keep as city if it was history
  if (desk === "history") {
    return "city";
  }

  return desk;
}

const VALID_NEW_DESKS = new Set(["city", "business", "crime", "sports", "health", "events", "politics", "people", "history", "science_tech"]);

// Load all stories
const rows = sqlite.prepare("SELECT id, desk, headline, summary FROM stories").all() as Array<{
  id: number;
  desk: string;
  headline: string;
  summary: string;
}>;

console.log(`[backfill-v2] processing ${rows.length} stories…`);

let reclassified = 0;
let kept = 0;
const deskCounts: Record<string, number> = {};

for (const row of rows) {
  let newDesk = row.desk;

  // Remap old desks
  if (!VALID_NEW_DESKS.has(row.desk)) {
    newDesk = remapOldDesk(row.desk, row.headline, row.summary);
  }

  deskCounts[newDesk] = (deskCounts[newDesk] ?? 0) + 1;

  if (newDesk !== row.desk) {
    sqlite.prepare("UPDATE stories SET desk = ? WHERE id = ?").run(newDesk, row.id);
    reclassified++;
  } else {
    kept++;
  }
}

// Set the backfilled flag
sqlite.prepare("INSERT INTO meta (key, value) VALUES ('backfilled_v2', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(new Date().toISOString());

console.log(`[backfill-v2] done! reclassified=${reclassified} kept=${kept}`);
console.log("[backfill-v2] desk counts:", JSON.stringify(deskCounts, null, 2));

sqlite.close();
