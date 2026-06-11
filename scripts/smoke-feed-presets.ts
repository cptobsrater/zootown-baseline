/**
 * Phase 6 smoke test for the feed_presets backend scaffold.
 *
 * Runs four end-to-end checks against the live Supabase pooler:
 *   1. listStoriesByPreset with desks=[] (no filter)
 *   2. listStoriesByPreset with desks=[sports]            (single-desk path)
 *   3. listStoriesByPreset with desks=[sports,entertainment] (composite path)
 *   4. createFeedPreset → listFeedPresets → recordFeedPresetEvent → softDelete
 *
 * Usage: cd zootown && npx tsx scripts/smoke-feed-presets.ts
 */

// IMPORTANT: load .env.local BEFORE importing storage.ts (it reads
// DATABASE_URL at module top-level).
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig(); // also pick up a plain .env if present

const { storage, queryClient } = await import("../server/storage.js");
const { feedPresetConfigSchema } = await import("../shared/schema.js");

async function main() {
  const log = (label: string, value: unknown) =>
    console.log(`\n=== ${label} ===\n`, value);

  // ---------- 1. desks=[] (no filter) ----------
  const cfgAll = feedPresetConfigSchema.parse({});
  const allFeed = await storage.listStoriesByPreset(cfgAll, {
    cityId: 1, // Missoula
    limit: 3,
  });
  log("1) desks=[] limit=3 cityId=1", {
    total: allFeed.total,
    returned: allFeed.items.length,
    sample: allFeed.items.slice(0, 2).map((s) => ({
      id: s.id,
      desk: s.desk,
      confidence: s.confidence,
      altDesks: s.altDesks,
      headline: s.headline?.slice(0, 60),
    })),
  });

  // ---------- 2. desks=[sports] ----------
  const cfgSports = feedPresetConfigSchema.parse({ desks: ["sports"] });
  const sportsFeed = await storage.listStoriesByPreset(cfgSports, {
    cityId: 1,
    limit: 3,
  });
  log("2) desks=[sports] limit=3 cityId=1", {
    total: sportsFeed.total,
    returned: sportsFeed.items.length,
    sample: sportsFeed.items
      .slice(0, 2)
      .map((s) => ({ id: s.id, desk: s.desk, confidence: s.confidence })),
  });

  // ---------- 3. desks=[sports,entertainment] composite + confidence sort ----------
  const cfgComposite = feedPresetConfigSchema.parse({
    desks: ["sports", "entertainment"],
    sort: "highest_confidence",
  });
  const compositeFeed = await storage.listStoriesByPreset(cfgComposite, {
    cityId: 1,
    limit: 5,
  });
  log("3) desks=[sports,entertainment] sort=highest_confidence", {
    total: compositeFeed.total,
    returned: compositeFeed.items.length,
    sample: compositeFeed.items.map((s) => ({
      id: s.id,
      desk: s.desk,
      altDesks: s.altDesks,
      confidence: s.confidence,
    })),
  });

  // ---------- 4. CRUD round-trip ----------
  const created = await storage.createFeedPreset({
    ownerId: "smoke-test",
    scope: "personal",
    name: `Smoke Sports+Arts ${Date.now()}`,
    slug: `smoke-sports-arts-${Date.now()}`,
    config: cfgComposite,
    cityId: 1,
    sortOrder: 0,
    isActive: true,
  });
  log("4a) createFeedPreset", {
    id: created.id,
    name: created.name,
    configVersion: created.configVersion,
  });

  const listed = await storage.listFeedPresets({ ownerId: "smoke-test" });
  log("4b) listFeedPresets ownerId=smoke-test", {
    count: listed.length,
    ids: listed.map((p) => p.id),
  });

  const ev = await storage.recordFeedPresetEvent({
    presetId: created.id,
    cityId: 1,
    adminId: "smoke-test",
    action: "apply",
    config: cfgComposite,
    payload: { source: "smoke-test" },
  });
  log("4c) recordFeedPresetEvent", {
    id: ev.id,
    action: ev.action,
    filterSignature: ev.filterSignature,
  });

  const deleted = await storage.softDeleteFeedPreset(created.id);
  log("4d) softDeleteFeedPreset", { deleted });

  const afterDelete = await storage.listFeedPresets({ ownerId: "smoke-test" });
  log("4e) listFeedPresets after softDelete (active only)", {
    count: afterDelete.length,
  });

  console.log("\n✅ All smoke checks passed.");
  await queryClient.end();
}

main().catch(async (err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  try {
    await queryClient.end();
  } catch {}
  process.exit(1);
});
