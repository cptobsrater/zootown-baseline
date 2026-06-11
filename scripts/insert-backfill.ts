/**
 * One-shot driver: read a JSONL file of pre-researched stories and insert
 * each row into the `stories` table with mod_state='approved' so they show
 * up immediately on the public feed.
 *
 * Usage:
 *   cd zootown && npx tsx scripts/insert-backfill.ts <path-to-jsonl>
 *
 * Each line of the JSONL must look like:
 *   {"city_id":2,"desk":"people","headline":"...","summary":"...",
 *    "source_name":"...","source_url":"...","source_type":"Local News",
 *    "tags":"[\"a\",\"b\"]","location":"..."}
 *
 * The script:
 *   - Skips lines whose source_url already exists in stories (idempotent)
 *   - Stamps published_at to a random recent timestamp in the past 30 days
 *     so the rebalancer doesn't bury 90 simultaneously-inserted rows at
 *     the same chronological position
 *   - Records a single attached source via attachStorySource so the drawer
 *     can enumerate sources uniformly
 *   - Prints a per-(city, desk) audit at the end
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig();

const { storage, queryClient } = await import("../server/storage.js");

type BackfillRow = {
  city_id: number;
  desk: string;
  headline: string;
  summary: string;
  source_name: string;
  source_url: string;
  source_type: string;
  tags: string;
  location: string | null;
};

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/insert-backfill.ts <jsonl-path>");
  process.exit(1);
}

const lines = readFileSync(path, "utf-8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Loaded ${lines.length} records from ${path}`);

// Random recent timestamp in the past 30 days. Spreading inserts across the
// window so the rebalancer / interleaver have realistic published_at values
// rather than 90 rows stacked at the same minute.
function randomRecentIso(): string {
  const now = Date.now();
  const thirty = 30 * 24 * 3600 * 1000;
  return new Date(now - Math.floor(Math.random() * thirty)).toISOString();
}

let inserted = 0;
let skipped = 0;
const errors: Array<{ line: number; err: string }> = [];

for (let i = 0; i < lines.length; i++) {
  const lineNo = i + 1;
  let row: BackfillRow;
  try {
    row = JSON.parse(lines[i]);
  } catch (e: any) {
    errors.push({ line: lineNo, err: `JSON parse: ${e?.message ?? e}` });
    continue;
  }
  try {
    // Idempotency: skip if a row with this source_url already exists.
    const existing = await storage.findStoryByCanonicalUrl(row.source_url);
    if (existing) {
      skipped++;
      continue;
    }
    const publishedAt = randomRecentIso();
    const story = await storage.createStory({
      headline: row.headline,
      summary: row.summary,
      desk: row.desk as any,
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      sourceType: row.source_type as any,
      modState: "approved" as any,
      publishedAt,
      fetchedAt: publishedAt,
      tags: row.tags,
      location: row.location ?? null,
      cityId: row.city_id,
      isReviewed: true,
      reviewedAt: publishedAt,
    } as any);
    await storage.attachStorySource(story.id, {
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      sourceType: row.source_type as any,
    });
    inserted++;
  } catch (e: any) {
    errors.push({ line: lineNo, err: e?.message ?? String(e) });
  }
}

console.log(
  `\nInserted ${inserted}  skipped (dupe URL) ${skipped}  errors ${errors.length}`,
);
if (errors.length) {
  for (const e of errors.slice(0, 10)) console.log(`  line ${e.line}: ${e.err}`);
}

await queryClient.end();
