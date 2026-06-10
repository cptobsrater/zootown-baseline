// Seed the 9 new Montana cities with their sources from data/cities/sources.json.
// Also stamps each city row with NWS zone + office for the weather widget.
import postgres from "postgres";
import { readFile } from "node:fs/promises";

const sql = postgres(process.env.DATABASE_URL, { max: 2, ssl: "require", prepare: false });
const data = JSON.parse(await readFile(new URL("../data/cities/sources.json", import.meta.url), "utf-8"));

let totalInserted = 0;
let totalSkipped = 0;

for (const [slug, info] of Object.entries(data)) {
  // Get city id and update NWS zone fields.
  const [cityRow] = await sql`SELECT id FROM cities WHERE slug = ${slug}`;
  if (!cityRow) {
    console.warn(`No city row for slug=${slug}, skipping`);
    continue;
  }
  const cityId = cityRow.id;
  await sql`
    UPDATE cities
       SET lat        = ${info.lat ?? null},
           lon        = ${info.lon ?? null},
           nws_zone   = ${info.nwsCountyZone ?? null}
     WHERE id = ${cityId}
  `;
  console.log(`\n[${slug}] city_id=${cityId}, updating ${info.sources?.length || 0} sources`);

  for (const s of info.sources ?? []) {
    // Dedupe by (cityId, url) so re-runs are idempotent.
    const [existing] = await sql`
      SELECT id FROM sources WHERE city_id = ${cityId} AND url = ${s.url} LIMIT 1
    `;
    if (existing) {
      totalSkipped++;
      continue;
    }
    const desks = JSON.stringify([s.defaultDesk || "city"]);
    await sql`
      INSERT INTO sources (
        name, url, feed_url, feed_type, parser_key,
        source_type, desks, cadence_minutes,
        last_status, last_items, active,
        category, handle, platform, trust_score, city_id
      ) VALUES (
        ${s.name}, ${s.url}, ${s.feedUrl ?? null}, ${s.feedType ?? "none"}, ${null},
        ${s.sourceType ?? "Local News"}, ${desks}, ${15},
        'idle', 0, true,
        ${s.category ?? "news"}, ${null}, ${null}, ${50}, ${cityId}
      )
    `;
    totalInserted++;
  }
}

console.log(`\nDone. Inserted ${totalInserted} new sources, skipped ${totalSkipped} duplicates.`);

const counts = await sql`SELECT c.slug, COUNT(s.id)::int AS n FROM cities c LEFT JOIN sources s ON s.city_id = c.id GROUP BY c.slug, c.sort_order ORDER BY c.sort_order`;
console.log("\nFinal source counts per city:");
for (const r of counts) console.log(`  ${r.slug}: ${r.n}`);

await sql.end();
