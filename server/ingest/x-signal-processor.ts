/**
 * X signal processor: turns tweets-with-article-links into ZooTown stories.
 *
 * Reads x_tweets.processed=false rows in batches, and for each tweet:
 *   1. If the tweet has linked_url, follow it (resolving t.co redirects)
 *      to the real article URL.
 *   2. Hand the resolved URL to the HTML fetcher to produce a story row.
 *      The fetcher already handles canonicalization + dedupe so duplicates
 *      across tweets become a single story.
 *   3. Stamp the tweet row with resulted_in_story_id so the cluster job
 *      can later trace tweet -> story.
 *   4. Mark processed=true regardless of outcome (failed fetches don't
 *      get retried forever; we log + move on).
 *
 * Tweets WITHOUT linked_url are just signals -- they get marked processed
 * (since the cluster job consumes them directly from x_tweets) and the
 * cluster job is the one that decides if they're worth synthesizing.
 *
 * Cron: invoked from the same scheduler tick as ingest, immediately after
 * the X fetcher pulls new tweets. Cheap to run -- normally 0-15 tweets
 * per tick to process.
 */
import { db, storage } from "../storage.js";
import { xTweets, sources as sourcesTable, stories } from "../../shared/schema.js";
import { eq, and, asc } from "drizzle-orm";
import type { Source, InsertStory } from "../../shared/schema.js";

const BATCH_SIZE = 30;

/**
 * Resolve a t.co (or any single-hop redirector) URL to the underlying
 * article URL. We follow up to 3 redirects with a tight timeout so an
 * unreachable host doesn't block the whole batch.
 *
 * Returns the final URL or null on failure.
 */
async function resolveRedirect(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "ZooTown-ingest/1.0 (+https://www.zootownhub.com)" },
    });
    clearTimeout(timeout);
    return res.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Pick (or lazily create) the synthetic "X discovery" Source row that all
 * X-referred stories belong to. We don't have one row per Twitter account;
 * the source name is always "X (Twitter list)" and trust scoring relies on
 * the per-tweet author_id metadata stored on the story itself.
 */
async function getOrCreateXSource(): Promise<Source | null> {
  const existing = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.name, "X (Twitter list)"));
  if (existing[0]) return existing[0] as Source;
  // Create on first use. cityId=null (statewide); type=html so the html
  // fetcher accepts the URL.
  const inserted = await db
    .insert(sourcesTable)
    .values({
      name: "X (Twitter list)",
      url: "https://x.com/i/lists/1773755931299594672",
      type: "html" as any,
      cadenceMinutes: 9999, // we never poll this Source directly
      active: false, // hidden from the scheduler
      trust: 50,
      cityId: null,
    } as any)
    .returning();
  return (inserted[0] as Source) ?? null;
}

export interface XSignalSummary {
  processed: number;
  articlesFetched: number;
  articlesFailed: number;
  signalsOnly: number;
}

/**
 * Process up to BATCH_SIZE unprocessed tweets.
 */
export async function processXSignals(): Promise<XSignalSummary> {
  const batch = await db
    .select()
    .from(xTweets)
    .where(eq(xTweets.processed, false))
    .orderBy(asc(xTweets.fetchedAt))
    .limit(BATCH_SIZE);

  const summary: XSignalSummary = {
    processed: 0,
    articlesFetched: 0,
    articlesFailed: 0,
    signalsOnly: 0,
  };
  if (batch.length === 0) return summary;

  for (const tweet of batch) {
    summary.processed += 1;

    if (!tweet.linkedUrl) {
      // Pure-signal tweet: no article to fetch. Mark processed; cluster
      // job will read it from x_tweets directly.
      await db
        .update(xTweets)
        .set({ processed: true })
        .where(eq(xTweets.tweetId, tweet.tweetId));
      summary.signalsOnly += 1;
      continue;
    }

    // Resolve t.co -> real URL.
    const finalUrl = await resolveRedirect(tweet.linkedUrl);
    if (!finalUrl) {
      // Failed to resolve. Still mark processed so we don't loop.
      await db
        .update(xTweets)
        .set({ processed: true })
        .where(eq(xTweets.tweetId, tweet.tweetId));
      summary.articlesFailed += 1;
      continue;
    }

    // De-dupe: has this URL already become a story (via RSS or another tweet)?
    const existing = await storage.findStoryByCanonicalUrl(finalUrl);
    if (existing) {
      // Already in the table. Stamp the tweet with the story id so the
      // cluster job can count multi-tweet confirmations.
      await db
        .update(xTweets)
        .set({ processed: true, resultedInStoryId: existing.id })
        .where(eq(xTweets.tweetId, tweet.tweetId));
      summary.articlesFetched += 1;
      continue;
    }

    // New URL. We don't deep-fetch the article here -- that's expensive and
    // belongs in a separate job that uses the existing HTML fetcher. For
    // v1, just record the tweet's article URL as a candidate story with
    // minimal fields. The follow-up article-enrichment job will replace
    // the placeholder headline/summary with the real article content.
    //
    // This keeps the tweet processor fast and lets the synthesizer cluster
    // signals immediately, even before article content arrives.
    const src = await getOrCreateXSource();
    if (!src) {
      summary.articlesFailed += 1;
      continue;
    }
    const insertStory: InsertStory = {
      headline: tweet.text.slice(0, 200), // placeholder; replaced by article fetch
      summary: tweet.text,
      sourceId: src.id,
      sourceUrl: finalUrl,
      canonicalUrl: finalUrl,
      cityId: tweet.cityId,
      desk: "city" as any, // placeholder; classifier will fix
      publishedAt: tweet.createdAt,
      modState: "pending" as any, // not user-visible until enriched + approved
      tags: [`x:@${tweet.authorUsername}`],
    } as any;
    let created;
    try {
      created = await storage.createStory(insertStory);
    } catch (err) {
      summary.articlesFailed += 1;
      await db
        .update(xTweets)
        .set({ processed: true })
        .where(eq(xTweets.tweetId, tweet.tweetId));
      continue;
    }
    await db
      .update(xTweets)
      .set({ processed: true, resultedInStoryId: created.id })
      .where(eq(xTweets.tweetId, tweet.tweetId));
    summary.articlesFetched += 1;
  }

  return summary;
}
