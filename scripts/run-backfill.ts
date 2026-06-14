import "dotenv/config";
import { reclassifyRecent, rescoreActive } from "../server/learning/story-enrichment.js";
async function main() {
  console.log("Classifying recent (last 30 days)...");
  const c = await reclassifyRecent({ ageHours: 30 * 24, limit: 5000 });
  console.log(`  scanned=${c.scanned} updated=${c.updated}`);
  console.log("Re-scoring active (last 14 days)...");
  const r = await rescoreActive({ ageHours: 14 * 24, limit: 5000 });
  console.log(`  scanned=${r.scanned} updated=${r.updated}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
