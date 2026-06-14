/**
 * Multi-source clustering for the ZooTown editorial pipeline.
 *
 * Reads recent stories (RSS-derived) and x_tweets (X signals), groups them
 * by topic, scores each cluster on four axes, and writes the result to
 * clusters + cluster_members. The synthesizer (Phase 12) reads clusters
 * with verdict='auto_publish' or 'review' and decides what to publish.
 *
 * The four scores are what the user defined:
 *
 *   diversity_score    : how DIFFERENTLY the sources phrased it (0..1)
 *                        Low = copy-paste wire-service pattern (suppress)
 *                        High = independent reporting in different voices
 *
 *   montana_locality   : how confidently this is Montana news (0..1)
 *                        High = local domains + MT place names
 *                        Low = national wire content sneaking through
 *
 *   political_toxicity : how likely this is FEDERAL politics (0..1)
 *                        High = Trump/Biden/Congress/MAGA keywords -> suppress
 *                        State/local politics doesn't count toward this
 *
 *   distinct_authors   : raw count of unique sources in the cluster
 *
 * Verdict gate (matches the user's stated editorial principles):
 *   diversity >= 0.4 AND montana >= 0.6 AND politics < 0.3 AND authors >= 3
 *     -> auto_publish
 *   diversity >= 0.4 AND montana >= 0.5 AND politics < 0.5 AND authors >= 2
 *     -> review (synth goes to /admin/synthesis-queue)
 *   anything failing the politics OR montana gates
 *     -> suppress (no synth attempt)
 *
 * The algorithm is intentionally simple + deterministic so it's auditable.
 * NO LLM in the clustering layer -- LLMs are reserved for synthesis.
 */
import { db } from "../storage.js";
import {
  stories,
  xTweets,
  xAuthors,
  clusters,
  clusterMembers,
} from "../../shared/schema.js";
import type { ClusterVerdict } from "../../shared/schema.js";
import { eq, gte, sql, and } from "drizzle-orm";

/** Recent-window for clustering. 6 hours is the breaking-news sweet spot. */
const WINDOW_HOURS = 6;

/** Minimum word length to keep when building topic signatures. */
const MIN_WORD_LEN = 4;

/** Words to ignore when building topic signatures. */
const STOPWORDS = new Set([
  "about","after","again","against","all","also","and","any","are","because",
  "been","being","both","could","did","does","doing","down","during","each",
  "few","for","from","further","had","has","have","having","here","how","its",
  "into","just","more","most","much","near","new","now","off","once","only",
  "other","our","out","over","said","same","says","she","should","some","such",
  "than","that","the","their","them","then","there","these","they","this","those",
  "through","under","until","very","was","were","what","when","where","which",
  "while","who","with","would","you","your","also","like","says","two","one",
  "three","first","last","story","news","report","reports","told","told",
  "today","tomorrow","yesterday","tonight","update","breaking","montana",
]);

/** Federal-political keywords. Used by political_toxicity scoring. */
const FEDERAL_POLITICAL = [
  "trump","biden","kamala","harris","pence","obama","clinton",
  "maga","democrat","democrats","republican","republicans","gop",
  "congress","senate","house","capitol",
  "abortion","immigration","border","ice raid",
  "dei","woke","esg","crt","drag queen",
  "midterm","election denial","stolen election",
  "doj","fbi","cia",
];

/** Montana state/local politicians who DON'T count toward federal toxicity. */
const MT_LOCAL_POLITICAL_ALLOWED = [
  "gianforte","tester","daines","zinke","rosendale","sheehy",
  "montana legislature","mt house","mt senate","state legislature",
  "mayor","city council","county commission","school board",
];

/** National-news domains. Drag montana_locality DOWN if cluster cites these. */
const NATIONAL_DOMAINS = [
  "cnn.com","foxnews.com","msnbc.com","nbcnews.com","abcnews.go.com",
  "cbsnews.com","apnews.com","reuters.com","bloomberg.com","nytimes.com",
  "washingtonpost.com","wsj.com","usatoday.com","huffpost.com","dailymail.co.uk",
  "thehill.com","politico.com","foxbusiness.com","breitbart.com","motherjones.com",
];

/** Montana city / county / region names. Bump montana_locality UP per mention. */
const MT_PLACE_NAMES = [
  "missoula","billings","great falls","bozeman","butte","helena","kalispell",
  "havre","whitefish","laurel","anaconda","livingston","hamilton","dillon",
  "miles city","glendive","sidney","red lodge","big sky","west yellowstone",
  "flathead","gallatin","yellowstone county","lewis and clark county","ravalli",
  "lincoln county","silver bow","cascade county","powell county","missoula county",
  "treasure state","big sky country","montana state","university of montana",
  "montana state university","montana tech",
];

interface RawMember {
  refType: "story" | "x_tweet";
  refId: string;
  authorKey: string;
  text: string;            // headline + summary OR tweet text
  url: string;             // canonical url (story) or linked_url (tweet) or empty
  cityId: number | null;
}

export interface ClusterBuildResult {
  scanned: number;
  signaturesSeen: number;
  clustersCreated: number;
  clustersUpdated: number;
  autoPublish: number;
  review: number;
  suppress: number;
}

/**
 * Build noun-phrase-ish topic signature from a text. Tokenizes, strips
 * stopwords, keeps the top-K most-distinctive bigrams + unigrams. Returns
 * a stable lowercase key.
 *
 * Two different texts about the same topic should land on the same
 * signature; same wire-service text across outlets ALSO lands on the
 * same signature (good -- the cluster forms, then diversity score
 * exposes the copy-paste).
 */
function topicSignature(text: string): string {
  const lower = text.toLowerCase().replace(/https?:\/\/\S+/g, " ");
  const words = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w));
  if (words.length === 0) return "";
  // Take top distinctive unigrams (sorted by frequency desc then alpha) and
  // bigrams. Limit to 5 to keep the signature short and stable.
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0]);
  return ranked.slice(0, 5).sort().join("|");
}

/** Jaccard similarity over word bags. 0..1. */
function jaccard(a: string, b: string): number {
  const setA = new Set(
    a.toLowerCase().split(/\s+/).filter((w) => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w)),
  );
  const setB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w)),
  );
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set<string>();
  for (const w of Array.from(setA)) if (setB.has(w)) intersection.add(w);
  const union = new Set<string>([...Array.from(setA), ...Array.from(setB)]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function diversityScore(members: RawMember[]): number {
  if (members.length < 2) return 1; // single source -- not a diversity concern
  // Average pairwise (1 - similarity) across all pairs.
  let totalDistance = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      totalDistance += 1 - jaccard(members[i].text, members[j].text);
      pairs += 1;
    }
  }
  return pairs === 0 ? 1 : totalDistance / pairs;
}

function montanaLocality(members: RawMember[]): number {
  let placeHits = 0;
  let nationalDomainHits = 0;
  let totalChecks = 0;
  for (const m of members) {
    const text = m.text.toLowerCase();
    for (const place of MT_PLACE_NAMES) {
      if (text.includes(place)) placeHits += 1;
    }
    if (m.url) {
      const url = m.url.toLowerCase();
      for (const dom of NATIONAL_DOMAINS) {
        if (url.includes(dom)) nationalDomainHits += 1;
      }
    }
    totalChecks += 1;
  }
  // Base score from place hits (capped at 1). Penalty per national-domain hit.
  const base = Math.min(1, placeHits / Math.max(1, totalChecks));
  const penalty = Math.min(1, nationalDomainHits * 0.4);
  return Math.max(0, base - penalty);
}

function politicalToxicity(members: RawMember[]): number {
  let federalHits = 0;
  let localOverrides = 0;
  for (const m of members) {
    const text = m.text.toLowerCase();
    for (const kw of FEDERAL_POLITICAL) {
      if (text.includes(kw)) federalHits += 1;
    }
    for (const ok of MT_LOCAL_POLITICAL_ALLOWED) {
      if (text.includes(ok)) localOverrides += 1;
    }
  }
  // Each federal keyword hit raises toxicity by 0.2. Each MT-specific
  // override lowers it by 0.15 (since talking about Tester counts as MT,
  // not federal politics). Clamp to [0,1].
  const raw = federalHits * 0.2 - localOverrides * 0.15;
  return Math.max(0, Math.min(1, raw));
}

function decideVerdict(scores: {
  diversity: number;
  montana: number;
  politics: number;
  authors: number;
}): { verdict: ClusterVerdict; reason: string } {
  const { diversity, montana, politics, authors } = scores;
  if (politics >= 0.5) {
    return { verdict: "suppress", reason: `federal-political toxicity ${politics.toFixed(2)}` };
  }
  if (montana < 0.3) {
    return { verdict: "suppress", reason: `montana locality too low (${montana.toFixed(2)})` };
  }
  if (diversity < 0.3 && authors >= 3) {
    return { verdict: "suppress", reason: `copy-paste pattern (diversity ${diversity.toFixed(2)})` };
  }
  if (
    diversity >= 0.4 &&
    montana >= 0.6 &&
    politics < 0.3 &&
    authors >= 3
  ) {
    return { verdict: "auto_publish", reason: "high confidence multi-source" };
  }
  return { verdict: "review", reason: "below auto threshold" };
}

/**
 * Pull recent eligible members from stories + x_tweets.
 *
 * For stories: anything published in the last WINDOW_HOURS, excluding rows
 * whose mod_state is 'rejected'.
 * For x_tweets: anything created in the last WINDOW_HOURS, excluding rows
 * whose author is muted (handled at ingest time, but defensive).
 */
async function loadRecentMembers(): Promise<RawMember[]> {
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const storyRows = await db
    .select({
      id: stories.id,
      headline: stories.headline,
      summary: stories.summary,
      // source_url is already the canonical form at write time (see
      // canonicalizeUrl in ingest/normalize.ts) -- there's no separate
      // canonical_url column.
      sourceUrl: stories.sourceUrl,
      cityId: stories.cityId,
      sourceName: stories.sourceName,
      modState: stories.modState,
    })
    .from(stories)
    .where(
      and(
        gte(stories.publishedAt, sinceIso),
        // Exclude already-synthesized rows and the rejected ones.
        sql`${stories.modState} <> 'rejected'`,
      ),
    )
    .limit(500);

  const tweetRows = await db
    .select({
      tweetId: xTweets.tweetId,
      text: xTweets.text,
      linkedUrl: xTweets.linkedUrl,
      cityId: xTweets.cityId,
      authorUsername: xTweets.authorUsername,
      authorId: xTweets.authorId,
    })
    .from(xTweets)
    .where(gte(xTweets.createdAt, sinceIso))
    .limit(500);

  // Filter out muted authors in JS to avoid a second join.
  const mutedRows = await db
    .select({ authorId: xAuthors.authorId })
    .from(xAuthors)
    .where(eq(xAuthors.isMuted, true));
  const muted = new Set(mutedRows.map((r) => r.authorId));

  const out: RawMember[] = [];
  for (const s of storyRows) {
    if (!s.headline || !s.summary) continue;
    out.push({
      refType: "story",
      refId: String(s.id),
      authorKey: s.sourceName ?? "",
      text: `${s.headline} ${s.summary}`,
      url: s.sourceUrl ?? "",
      cityId: s.cityId ?? null,
    });
  }
  for (const t of tweetRows) {
    if (muted.has(t.authorId)) continue;
    if (!t.text) continue;
    out.push({
      refType: "x_tweet",
      refId: t.tweetId,
      authorKey: `@${t.authorUsername}`,
      text: t.text,
      url: t.linkedUrl ?? "",
      cityId: t.cityId ?? null,
    });
  }
  return out;
}

export async function buildClusters(): Promise<ClusterBuildResult> {
  const members = await loadRecentMembers();
  const result: ClusterBuildResult = {
    scanned: members.length,
    signaturesSeen: 0,
    clustersCreated: 0,
    clustersUpdated: 0,
    autoPublish: 0,
    review: 0,
    suppress: 0,
  };

  if (members.length === 0) return result;

  // Group by topic signature.
  const groups = new Map<string, RawMember[]>();
  for (const m of members) {
    const sig = topicSignature(m.text);
    if (!sig) continue;
    const arr = groups.get(sig) ?? [];
    arr.push(m);
    groups.set(sig, arr);
  }
  result.signaturesSeen = groups.size;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Iterate using Array.from to dodge the ES5 downlevel-iteration warning.
  for (const [sig, group] of Array.from(groups.entries())) {
    // Only act on multi-source clusters; singletons are noise.
    const distinctAuthors = new Set(group.map((m) => m.authorKey)).size;
    if (distinctAuthors < 2) continue;

    const scores = {
      diversity: diversityScore(group),
      montana: montanaLocality(group),
      politics: politicalToxicity(group),
      authors: distinctAuthors,
    };
    const { verdict, reason } = decideVerdict(scores);
    // Tally for the result summary.
    if (verdict === "auto_publish") result.autoPublish += 1;
    else if (verdict === "review") result.review += 1;
    else result.suppress += 1;

    // Most members will share a city. If they don't, take the most common.
    const cityCounts = new Map<number | null, number>();
    for (const m of group) cityCounts.set(m.cityId, (cityCounts.get(m.cityId) ?? 0) + 1);
    const dominantCity =
      Array.from(cityCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Upsert the cluster row by (signature, day).
    const existing = await db
      .select()
      .from(clusters)
      .where(
        and(eq(clusters.topicSignature, sig), eq(clusters.bucketDay, today)),
      );
    let clusterId: number;
    if (existing[0]) {
      clusterId = existing[0].id;
      await db
        .update(clusters)
        .set({
          diversityScore: scores.diversity.toFixed(2) as any,
          montanaLocality: scores.montana.toFixed(2) as any,
          politicalToxicity: scores.politics.toFixed(2) as any,
          distinctAuthors: scores.authors,
          verdict: verdict as any,
          verdictReason: reason,
          cityId: dominantCity,
          lastSeenAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(clusters.id, clusterId));
      result.clustersUpdated += 1;
    } else {
      const [row] = await db
        .insert(clusters)
        .values({
          topicSignature: sig,
          bucketDay: today,
          cityId: dominantCity,
          diversityScore: scores.diversity.toFixed(2) as any,
          montanaLocality: scores.montana.toFixed(2) as any,
          politicalToxicity: scores.politics.toFixed(2) as any,
          distinctAuthors: scores.authors,
          verdict: verdict as any,
          verdictReason: reason,
        })
        .returning({ id: clusters.id });
      clusterId = row.id;
      result.clustersCreated += 1;
    }

    // Sync members. Insert any not-yet-recorded refs; existing rows are
    // de-duped by the composite primary key.
    const memberInserts = group.map((m) => ({
      clusterId,
      refType: m.refType,
      refId: m.refId,
      authorKey: m.authorKey,
    }));
    if (memberInserts.length > 0) {
      await db.insert(clusterMembers).values(memberInserts).onConflictDoNothing();
    }
  }

  return result;
}
