/**
 * One-shot seed script for historical_profiles.
 *
 * Reads HISTORICAL_PROFILES_SEED from historical-profiles-seed.ts and inserts
 * each row, skipping any whose (subjectName, anniversaryMonth, anniversaryDay)
 * tuple is already present. Idempotent — safe to re-run after adding entries.
 *
 * Sandbox can't reach the Supabase pooler directly, so this script is
 * normally invoked from a local dev machine OR run as a one-off Vercel
 * function. We'll wrap an admin route around it for the latter.
 */
import { HISTORICAL_PROFILES_SEED } from "./historical-profiles-seed.js";
import { db } from "../server/db.js";
import { historicalProfiles } from "../shared/schema.js";
import { sql } from "drizzle-orm";

async function main() {
  const seed = HISTORICAL_PROFILES_SEED;
  console.log(`[seed] candidate entries: ${seed.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const profile of seed) {
    const existing = (await db.execute(sql`
      SELECT id FROM historical_profiles
      WHERE subject_name = ${profile.subjectName}
        AND anniversary_month = ${profile.anniversaryMonth}
        AND anniversary_day   = ${profile.anniversaryDay}
      LIMIT 1
    `)) as unknown as { id: number }[];
    if (existing[0]) {
      skipped++;
      continue;
    }
    await db.insert(historicalProfiles).values(profile as any);
    inserted++;
  }

  console.log(`[seed] inserted ${inserted}, skipped ${skipped} (already present)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
