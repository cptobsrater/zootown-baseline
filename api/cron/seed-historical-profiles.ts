/**
 * One-shot seed loader for historical_profiles.
 *
 * Not a recurring cron — it lives under /api/cron/ so it picks up the
 * CRON_SECRET auth guard for free. Call it once after deploy with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://www.zootownhub.com/api/cron/seed-historical-profiles
 *
 * Re-runnable: each row dedupes by (subject_name, anniversary_month,
 * anniversary_day), so updating the seed file and re-hitting the endpoint
 * only inserts genuinely new rows.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../../server/storage.js";
import { historicalProfiles } from "../../shared/schema.js";
import { sql } from "drizzle-orm";
import { HISTORICAL_PROFILES_SEED } from "../../scripts/historical-profiles-seed.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const seed = HISTORICAL_PROFILES_SEED;
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of seed) {
    try {
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
    } catch (err: any) {
      errors.push(`${profile.subjectName}: ${err?.message ?? err}`);
    }
  }

  res.json({ ok: true, candidates: seed.length, inserted, skipped, errors });
}
