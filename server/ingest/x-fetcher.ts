/**
 * X (Twitter) API ingest -- pulls the curated Montana list and writes
 * each new tweet to x_tweets as a SIGNAL (not a story).
 *
 * Cron schedule lives in server/scheduler.ts:
 *   - 15-min cadence during local daytime (07:00-23:00 MT)
 *   - 60-min cadence overnight
 *   - That works out to ~9,840 tweets/month, comfortably under the 10k
 *     Basic-tier read cap, with a since_id cursor preventing duplicate
 *     reads.
 *
 * Cap protection:
 *   - x_list_cursor.tweets_this_month counts every tweet returned
 *   - When the count crosses 9,500 we hard-stop polling until the next
 *     month rolls over (defined as 30 days since month_started_at)
 *   - last_error captures the latest failure so the cockpit can show it
 *
 * Tweets land in x_tweets with processed=false. A separate signal
 * processor (server/ingest/x-signal-processor.ts) picks them up,
 * extracts any linked article URL, and hands the URL to the existing
 * HTML fetcher to land in stories table.
 */
import { db } from "../storage.js";
import { xTweets, xAuthors, xUnmapped, xListCursor } from "../../shared/schema.js";
import { eq, sql } from "drizzle-orm";

/** X's Montana-list ID, hard-coded for now. Move to env if we ever add a second list. */
export const MONTANA_LIST_ID = "1773755931299594672";

/** Hard cap below the actual 10k/month tier limit. Leaves headroom for retries. */
const MONTHLY_CAP = 9500;

/** Per-poll max_results passed to the X API. 100 is the X-side ceiling. */
const PER_POLL_MAX = 50;

interface XApiUser {
  id: string;
  name: string;
  username: string;
}

interface XApiTweetMetrics {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

interface XApiTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: XApiTweetMetrics;
  edit_history_tweet_ids?: string[];
}

interface XApiResponse {
  data?: XApiTweet[];
  includes?: {
    users?: XApiUser[];
  };
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
  };
  errors?: { title: string; detail: string }[];
}

export interface XFetchResult {
  polled: boolean;
  reason?: string; // why we didn't poll, if !polled
  tweetsFetched: number;
  newAuthors: number;
  monthlyUsage: number;
}

/**
 * Extract the first non-x.com URL from a tweet's text. X tweets normally
 * shorten URLs to t.co; the API expands them in entities.urls but for
 * simplicity we just regex on the visible text for any http(s)://... link
 * that's NOT x.com / twitter.com.
 *
 * The actual de-shortening happens later when the HTML fetcher follows the
 * t.co redirect during article fetch.
 */
function extractLinkedUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s)\]]+/g);
  if (!urls) return null;
  for (const u of urls) {
    // Skip self-referential links (X media, t.co, x.com, twitter.com)
    if (/^https?:\/\/(t\.co|x\.com|twitter\.com|pic\.twitter\.com)/i.test(u)) {
      // t.co is interesting -- it shortens external links. Treat the
      // FIRST t.co link as the linked-article candidate; the HTML fetcher
      // will follow the redirect to the real destination.
      if (/^https?:\/\/t\.co\//i.test(u)) return u;
      continue;
    }
    return u;
  }
  return null;
}

/**
 * Main entry point. Polls the X list and writes new tweets to x_tweets.
 * Returns a summary the cockpit can show.
 */
export async function pollXList(opts: {
  listId?: string;
  bearerToken?: string;
} = {}): Promise<XFetchResult> {
  const listId = opts.listId ?? MONTANA_LIST_ID;
  const bearer = opts.bearerToken ?? process.env.X_BEARER_TOKEN;
  if (!bearer) {
    return {
      polled: false,
      reason: "X_BEARER_TOKEN not set in environment",
      tweetsFetched: 0,
      newAuthors: 0,
      monthlyUsage: 0,
    };
  }

  // Load (or seed) the cursor row. The migration already inserted a row
  // for MONTANA_LIST_ID so this select normally returns 1 row.
  let cursor: typeof xListCursor.$inferSelect | undefined;
  const cursorRows = await db.select().from(xListCursor).where(eq(xListCursor.listId, listId));
  cursor = cursorRows[0];
  if (!cursor) {
    // Defensive: create the row if the seed migration was somehow skipped.
    await db.insert(xListCursor).values({ listId });
    cursor = (await db.select().from(xListCursor).where(eq(xListCursor.listId, listId)))[0];
  }
  if (!cursor) {
    return {
      polled: false,
      reason: "Failed to initialize x_list_cursor row",
      tweetsFetched: 0,
      newAuthors: 0,
      monthlyUsage: 0,
    };
  }

  // Roll the monthly counter if 30 days have elapsed since the window
  // started. We don't try to match X's calendar-month billing exactly;
  // close-enough rolling 30-day windows keep us safe.
  const monthStart = new Date(cursor.monthStartedAt);
  const now = new Date();
  const daysSinceStart = (now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceStart >= 30) {
    await db
      .update(xListCursor)
      .set({
        tweetsThisMonth: 0,
        monthStartedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(xListCursor.listId, listId));
    cursor.tweetsThisMonth = 0;
  }

  if (cursor.tweetsThisMonth >= MONTHLY_CAP) {
    return {
      polled: false,
      reason: `Monthly cap reached (${cursor.tweetsThisMonth}/${MONTHLY_CAP})`,
      tweetsFetched: 0,
      newAuthors: 0,
      monthlyUsage: cursor.tweetsThisMonth,
    };
  }

  // Build the request URL. Asking for the fields we'll actually use, plus
  // expansion of author_id so the response includes the user objects (saves
  // a separate /users/by/id call per poll).
  const params = new URLSearchParams({
    max_results: String(PER_POLL_MAX),
    "tweet.fields": "created_at,author_id,public_metrics",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  if (cursor.lastTweetId) {
    params.set("since_id", cursor.lastTweetId);
  }

  const url = `https://api.x.com/2/lists/${listId}/tweets?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
  } catch (err: any) {
    await db
      .update(xListCursor)
      .set({
        lastError: `Network: ${err?.message ?? String(err)}`,
        lastPolledAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(xListCursor.listId, listId));
    return {
      polled: false,
      reason: `Network error: ${err?.message ?? err}`,
      tweetsFetched: 0,
      newAuthors: 0,
      monthlyUsage: cursor.tweetsThisMonth,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errMsg = `HTTP ${response.status}: ${body.slice(0, 200)}`;
    await db
      .update(xListCursor)
      .set({
        lastError: errMsg,
        lastPolledAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(xListCursor.listId, listId));
    return {
      polled: false,
      reason: errMsg,
      tweetsFetched: 0,
      newAuthors: 0,
      monthlyUsage: cursor.tweetsThisMonth,
    };
  }

  const json = (await response.json()) as XApiResponse;
  const tweets = json.data ?? [];
  const users = json.includes?.users ?? [];

  // Build a quick author_id -> user lookup for this batch.
  const userById = new Map<string, XApiUser>();
  for (const u of users) userById.set(u.id, u);

  // Preload our author mapping for the authors in THIS batch (single query)
  const distinctAuthorIds = Array.from(new Set(tweets.map((t) => t.author_id)));
  const knownAuthors = new Map<string, typeof xAuthors.$inferSelect>();
  if (distinctAuthorIds.length > 0) {
    const rows = await db
      .select()
      .from(xAuthors)
      .where(sql`${xAuthors.authorId} IN (${sql.join(distinctAuthorIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of rows) knownAuthors.set(r.authorId, r);
  }

  let newAuthors = 0;
  const tweetInserts: typeof xTweets.$inferInsert[] = [];
  for (const t of tweets) {
    const user = userById.get(t.author_id);
    const author = knownAuthors.get(t.author_id);
    if (author?.isMuted) continue; // honor mute setting -- never ingest

    const username = user?.username ?? "";
    const displayName = user?.name ?? "";

    if (!author && user) {
      // Add / bump the unmapped queue row. We upsert by author_id so
      // multiple tweets from the same unmapped author collapse to one row.
      const existing = await db
        .select()
        .from(xUnmapped)
        .where(eq(xUnmapped.authorId, t.author_id));
      if (existing.length === 0) {
        await db.insert(xUnmapped).values({
          authorId: t.author_id,
          username,
          displayName,
          lastTweetId: t.id,
          lastTweetText: t.text,
        });
        newAuthors += 1;
      } else {
        await db
          .update(xUnmapped)
          .set({
            seenCount: sql`${xUnmapped.seenCount} + 1` as any,
            lastTweetId: t.id,
            lastTweetText: t.text,
            lastSeen: now.toISOString(),
          })
          .where(eq(xUnmapped.authorId, t.author_id));
      }
    }

    tweetInserts.push({
      tweetId: t.id,
      authorId: t.author_id,
      authorUsername: username,
      text: t.text,
      linkedUrl: extractLinkedUrl(t.text),
      retweetCount: t.public_metrics?.retweet_count ?? 0,
      replyCount: t.public_metrics?.reply_count ?? 0,
      likeCount: t.public_metrics?.like_count ?? 0,
      quoteCount: t.public_metrics?.quote_count ?? 0,
      impressionCount: t.public_metrics?.impression_count ?? 0,
      cityId: author?.cityId ?? null,
      processed: false,
      createdAt: t.created_at,
    });
  }

  if (tweetInserts.length > 0) {
    // onConflictDoNothing -- if for any reason we re-pull the same tweet ID
    // (since_id race, retry on partial failure) we don't error.
    await db.insert(xTweets).values(tweetInserts).onConflictDoNothing();
  }

  // Advance the cursor to the newest tweet we just saw.
  const newestId =
    json.meta?.newest_id ??
    (tweets.length > 0
      ? tweets.reduce((a, b) => (BigInt(a.id) > BigInt(b.id) ? a : b)).id
      : cursor.lastTweetId);

  await db
    .update(xListCursor)
    .set({
      lastTweetId: newestId ?? cursor.lastTweetId,
      tweetsThisMonth: cursor.tweetsThisMonth + tweets.length,
      lastPolledAt: now.toISOString(),
      lastError: null,
      updatedAt: now.toISOString(),
    })
    .where(eq(xListCursor.listId, listId));

  return {
    polled: true,
    tweetsFetched: tweets.length,
    newAuthors,
    monthlyUsage: cursor.tweetsThisMonth + tweets.length,
  };
}
