/**
 * Smoke test for the desk-balanced public feed page.
 *
 * Calls listStories twice for Butte (city_id=5) at limit=10:
 *   1. rebalance=false  -- raw chronological (the bug case)
 *   2. rebalance=true   -- balanced page (the fix)
 * and prints the desk distribution of each so the difference is obvious.
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig();

const { storage, queryClient } = await import("../server/storage.js");

async function run(cityId: number, cityName: string) {
  console.log(`\n========== ${cityName} (city_id=${cityId}) ==========`);
  for (const rebalance of [false, true]) {
    const out = await storage.listStories({
      cityId,
      limit: 10,
      rebalance,
    });
    const desks = out.items.map((s: any) => s.desk);
    const counts: Record<string, number> = {};
    for (const d of desks) counts[d] = (counts[d] ?? 0) + 1;
    console.log(`\n  rebalance=${rebalance}:`);
    console.log(`    sequence: ${desks.join(" -> ")}`);
    console.log(`    counts:   ${JSON.stringify(counts)}`);
    console.log(`    nextCursor=${out.nextCursor}  total=${out.total}`);
  }
}

await run(5, "Butte");
await run(3, "Great Falls");
await run(1, "Missoula");
await run(2, "Billings");

await queryClient.end();
