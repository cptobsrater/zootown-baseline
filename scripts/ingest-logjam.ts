/**
 * One-shot driver: run ingestSource() for every active Logjam-family source.
 * Used to seed the calendar from the new two-stage parser without waiting
 * for the production Vercel cron.
 *
 * Usage: cd zootown && npx tsx scripts/ingest-logjam.ts
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig();

const { storage, queryClient } = await import("../server/storage.js");
const { ingestSource } = await import("../server/ingest/ingester.js");

async function main() {
  const sources = (await storage.listSources()).filter(
    (s: any) => s.active && s.parserKey === "logjam",
  );
  console.log(`Found ${sources.length} active logjam sources:`);
  for (const s of sources) console.log(`  - [${s.id}] ${s.name} (city_id=${s.cityId})`);

  for (const s of sources) {
    console.log(`\n=== running ${s.name} ===`);
    const t0 = Date.now();
    const summary = await ingestSource(s);
    const ms = Date.now() - t0;
    console.log(
      `  ${ms}ms  mode=${summary.mode}  fetched=${summary.fetched}  added=${summary.added}  dupes=${summary.duplicates}  errors=${summary.errors}  msg=${summary.message ?? "(none)"}`,
    );
  }

  await queryClient.end();
}

main().catch(async (err) => {
  console.error("ingest driver failed:", err);
  try {
    await queryClient.end();
  } catch {}
  process.exit(1);
});
