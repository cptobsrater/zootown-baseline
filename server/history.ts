/**
 * History pool management:
 * - Seeds 10 history stories on first boot
 * - Weekly rotation: bumps the oldest lastBumpedAt to now
 */
import { storage } from "./storage";
import { HISTORY_SEED } from "./history-seed";

const HISTORY_POOL_SIZE = 10;
const ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROTATION_META_KEY = "history_last_rotation";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check hourly

export function seedHistoryIfEmpty() {
  const count = storage.countHistoryStories();
  if (count > 0) return;

  console.log("[history] seeding 10 history stories…");
  const now = Date.now();
  for (let i = 0; i < HISTORY_SEED.length; i++) {
    const story = HISTORY_SEED[i];
    // Stagger publishedAt: 1 story per day going back (HISTORY_SEED.length - i) days
    const publishedAt = new Date(now - (HISTORY_SEED.length - i) * 24 * 60 * 60 * 1000).toISOString();
    const lastBumpedAt = publishedAt;
    storage.createHistoryStory({
      headline: story.headline,
      summary: story.summary,
      sourceUrl: story.sourceUrl ?? null,
      publishedAt,
      lastBumpedAt,
    });
  }
  console.log("[history] seeded 10 history stories");
}

export function historyRotationTick() {
  const lastRotation = storage.getMeta(ROTATION_META_KEY);
  const lastMs = lastRotation ? Date.parse(lastRotation) : 0;
  if (Date.now() - lastMs < ROTATION_INTERVAL_MS) return;

  console.log("[history] rotating oldest story to top");
  storage.bumpOldestHistoryStory();
  storage.setMeta(ROTATION_META_KEY, new Date().toISOString());
}

export function startHistoryRotationScheduler() {
  setTimeout(function tick() {
    try {
      historyRotationTick();
    } catch (err) {
      console.error("[history] rotation tick error:", err);
    }
    setTimeout(tick, CHECK_INTERVAL_MS);
  }, CHECK_INTERVAL_MS);
}

/**
 * Add a new history story. If pool exceeds HISTORY_POOL_SIZE,
 * removes the one with the oldest publishedAt.
 */
export function addHistoryStory(headline: string, summary: string, sourceUrl?: string) {
  const now = new Date().toISOString();
  const story = storage.createHistoryStory({
    headline,
    summary,
    sourceUrl: sourceUrl ?? null,
    publishedAt: now,
    lastBumpedAt: now,
  });

  // Trim pool if over max — remove oldest by publishedAt (not the new one)
  const all = storage.listHistoryStories().sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  if (all.length > HISTORY_POOL_SIZE) {
    const oldest = all[0];
    if (oldest && oldest.id !== story.id) {
      // Use storage sqlite directly
      const { deleteHistoryStory } = storage as any;
      if (typeof deleteHistoryStory === "function") {
        deleteHistoryStory(oldest.id);
      } else {
        // Fallback: use the internal sqlite reference via a direct method
        (storage as any).deleteHistoryStoryById?.(oldest.id);
      }
    }
  }

  return story;
}
