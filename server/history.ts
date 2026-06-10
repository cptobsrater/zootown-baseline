/**
 * Long-form pool management for History + People desks.
 *
 * Storage model:
 * - DB holds an unlimited number of articles per desk.
 * - Only `is_visible = true` rows surface on the public site.
 * - A weekly rotation picks ~100 per desk into the visible window; the rest
 *   stay in the DB and can be brought back next cycle (or by admin).
 *
 * Daily writer:
 * - Every 24h, the writer produces ONE new article. It alternates between
 *   the People desk and the History desk so the collection grows evenly.
 * - All articles publish directly; admin can edit/delete from the backend.
 */
import { storage } from "./storage";
import { HISTORY_SEED } from "./history-seed";
import { generateNextArticle } from "./writer";

const VISIBLE_WINDOW = 100;          // rotating display per desk
const ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const ROTATION_META_KEY = "history_last_rotation";
const DAILY_WRITE_INTERVAL_MS = 24 * 60 * 60 * 1000;    // 1 day
const DAILY_WRITE_META_KEY = "history_last_daily_write";
const DAILY_DESK_META_KEY = "history_last_daily_desk";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly tick

/** First-boot seed (history desk only — people desk starts empty and grows via writer). */
export async function seedHistoryIfEmpty() {
  const count = await storage.countHistoryStories();
  if (count > 0) return;
  console.log("[history] seeding history desk from HISTORY_SEED…");
  const now = Date.now();
  for (let i = 0; i < HISTORY_SEED.length; i++) {
    const story = HISTORY_SEED[i];
    const publishedAt = new Date(now - (HISTORY_SEED.length - i) * 24 * 60 * 60 * 1000).toISOString();
    await storage.createHistoryStory({
      headline: story.headline,
      summary: story.summary,
      sourceUrl: story.sourceUrl ?? null,
      desk: "history",
      kind: "history",
      publishedAt,
      lastBumpedAt: publishedAt,
    } as any);
  }
  console.log(`[history] seeded ${HISTORY_SEED.length} history articles`);
}

/**
 * Pick ~100 articles per desk to be visible. Strategy:
 * 1. Always include the N most-recently-added.
 * 2. Fill remaining slots with the least-recently-shown of the rest, so older
 *    articles cycle back into view over time.
 * Everything else gets is_visible=false until the next rotation.
 */
export async function rotateVisibleWindow() {
  for (const desk of ["history", "people"] as const) {
    const all = await storage.listAllHistoryStoriesForDesk(desk);
    if (all.length <= VISIBLE_WINDOW) {
      // Whole pool fits — everything visible.
      await storage.setHistoryVisibility(all.map((s) => s.id), true);
      continue;
    }
    // Most-recently-added first half
    const recent = [...all].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, Math.floor(VISIBLE_WINDOW / 2));
    const recentIds = new Set(recent.map((s) => s.id));
    // Fill the rest with the least-recently-shown
    const remaining = all
      .filter((s) => !recentIds.has(s.id))
      .sort((a, b) => {
        const at = a.lastShownAt ?? "";
        const bt = b.lastShownAt ?? "";
        return at.localeCompare(bt);
      })
      .slice(0, VISIBLE_WINDOW - recent.length);
    const visibleIds = [...recent.map((s) => s.id), ...remaining.map((s) => s.id)];
    const hiddenIds = all.filter((s) => !visibleIds.includes(s.id)).map((s) => s.id);
    await storage.setHistoryVisibility(visibleIds, true);
    await storage.setHistoryVisibility(hiddenIds, false);
    await storage.markHistoryShownNow(visibleIds);
  }
}

export async function rotationTick() {
  const lastRotation = await storage.getMeta(ROTATION_META_KEY);
  const lastMs = lastRotation ? Date.parse(lastRotation) : 0;
  if (Date.now() - lastMs < ROTATION_INTERVAL_MS) return;
  console.log("[history] rotating visible window for history + people");
  await rotateVisibleWindow();
  await storage.setMeta(ROTATION_META_KEY, new Date().toISOString());
}

/** One article per day, alternating People ↔ History. */
export async function dailyWriteTick() {
  const lastWrite = await storage.getMeta(DAILY_WRITE_META_KEY);
  const lastMs = lastWrite ? Date.parse(lastWrite) : 0;
  if (Date.now() - lastMs < DAILY_WRITE_INTERVAL_MS) return;

  const lastDesk = (await storage.getMeta(DAILY_DESK_META_KEY)) ?? "history";
  const nextDesk: "people" | "history" = lastDesk === "history" ? "people" : "history";

  try {
    const article = await generateNextArticle(nextDesk);
    if (!article) {
      console.warn(`[writer] generator returned null for ${nextDesk}`);
      return;
    }
    const now = new Date().toISOString();
    await storage.createHistoryStory({
      headline: article.headline,
      summary: article.body,
      sourceUrl: article.sourceUrl ?? null,
      desk: nextDesk,
      kind: article.kind,
      publishedAt: now,
      lastBumpedAt: now,
    } as any);
    await storage.setMeta(DAILY_WRITE_META_KEY, now);
    await storage.setMeta(DAILY_DESK_META_KEY, nextDesk);
    console.log(`[writer] wrote daily ${nextDesk} article: "${article.headline}"`);
  } catch (err) {
    console.error("[writer] daily write error:", err);
  }
}

export function startLongFormScheduler() {
  setTimeout(async function tick() {
    try { await rotationTick(); } catch (err) { console.error("[history] rotation error:", err); }
    try { await dailyWriteTick(); } catch (err) { console.error("[history] daily write error:", err); }
    setTimeout(tick, CHECK_INTERVAL_MS);
  }, CHECK_INTERVAL_MS);
}

/** Admin-triggered single-shot publish (manual "Add to pool" form). */
export async function addHistoryStory(
  headline: string,
  summary: string,
  sourceUrl?: string,
  desk: "history" | "people" = "history",
  kind: "history" | "profile" | "obituary" = "history",
) {
  const now = new Date().toISOString();
  return await storage.createHistoryStory({
    headline,
    summary,
    sourceUrl: sourceUrl ?? null,
    desk,
    kind,
    publishedAt: now,
    lastBumpedAt: now,
  } as any);
}
