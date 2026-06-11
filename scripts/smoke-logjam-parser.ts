/**
 * Smoke test for the Logjam two-stage parser.
 *
 * Hits the live Logjam listing page, runs the parser end-to-end including
 * detail-page fetches, and prints what would be inserted. Tests three
 * source variants:
 *   - umbrella "Logjam Presents" (no venue filter, accept all venues)
 *   - "KettleHouse Amphitheater" (filter to kettlehouse only)
 *   - "The ELM" (filter to ELM only)
 *
 * Usage: cd zootown && npx tsx scripts/smoke-logjam-parser.ts
 */

import { htmlFetcher } from "../server/ingest/html.js";
import type { Source } from "../shared/schema.js";

function fakeSource(name: string, parserKey: string): Source {
  return {
    id: 0,
    name,
    url: "https://logjampresents.com/events/",
    feedUrl: "https://logjampresents.com/events/",
    feedType: "html",
    parserKey,
    sourceType: "Community Calendar",
    desks: null,
    categoryPriority: 0,
    cadenceMinutes: 60,
    lastCheckedAt: null,
    lastStatus: null,
    lastMode: null,
    lastError: null,
    lastItems: 0,
    active: true,
    category: "calendars",
    handle: null,
    platform: null,
    trustScore: 1,
    cityId: 1,
  } as unknown as Source;
}

async function run() {
  const variants = [
    fakeSource("Logjam Presents", "logjam"),
    fakeSource("KettleHouse Amphitheater", "logjam"),
    fakeSource("The Wilma", "logjam"),
    fakeSource("The ELM", "logjam"),
    fakeSource("Top Hat", "logjam"),
  ];

  for (const src of variants) {
    const t0 = Date.now();
    const result = await htmlFetcher.fetch(src, { timeoutMs: 15000 });
    const ms = Date.now() - t0;
    console.log(`\n=== ${src.name} (parserKey=${src.parserKey}, ${ms}ms) ===`);
    console.log(`mode=${result.mode}  items=${result.items.length}  error=${result.error ?? "(none)"}`);
    for (const item of result.items.slice(0, 5)) {
      console.log(
        `  - ${item.title}\n      url=${item.url}\n      publishedAt=${item.publishedAt}\n      summary=${item.summary?.slice(0, 120)}`,
      );
    }
    if (result.items.length > 5) {
      console.log(`  ... ${result.items.length - 5} more`);
    }
  }
}

run().catch((err) => {
  console.error("smoke test failed:", err);
  process.exit(1);
});
