/**
 * Synthesis pipeline -- turns approved/auto-publish clusters into stories.
 *
 * Reads clusters with verdict='auto_publish' OR 'review' that don't yet
 * have a synthesis_story_id. For each:
 *   1. Loads the cluster's member stories (and tweets, secondarily)
 *   2. Builds a prompt with the source excerpts + the editorial principles
 *   3. Calls Gemini Flash to produce { headline, body, desk }
 *   4. Validates the response
 *   5. Branches by verdict:
 *      - auto_publish: insert as a story, mark cluster done, status='published'
 *      - review:       insert into synthesis_queue for human approval
 *
 * The system prompt encodes the editorial principles the user set:
 *   - Lead with facts, never framing
 *   - Show both sides at their best; never use rebuttal-while-explaining tricks
 *   - Crime is crime, not politics -- indicted politicians go on Crime desk
 *   - Make federal politics Montana-relevant or don't publish it
 *   - Short, neutral, sourced -- no opinion adjectives
 *
 * Cost: Gemini 1.5 Flash is essentially free at our volume (1500/day free).
 * A single synthesis call is ~1500 input tokens + ~250 output tokens.
 */
import { db, storage } from "../storage.js";
import {
  clusters,
  clusterMembers,
  stories,
  synthesisQueue,
} from "../../shared/schema.js";
import type { Cluster } from "../../shared/schema.js";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";

const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const VALID_DESKS = [
  "city", "business", "crime", "sports", "health",
  "entertainment", "people", "history",
] as const;
type Desk = (typeof VALID_DESKS)[number];

/**
 * The system prompt. Every editorial principle the user set lives here.
 * Updating this is the single lever for tuning synthesis voice.
 */
const SYSTEM_PROMPT = `You are ZooTown's editorial synthesizer for a Montana local news aggregator.

You receive 2-6 source articles or tweets that other Montana journalists have published about the same topic. Your job is to produce ONE neutral, factual summary suitable for ZooTown readers.

CORE PRINCIPLES (non-negotiable):

1. LEAD WITH FACTS, NOT FRAMING
   - Bad: "Trump arrives in France desperate for Iran help at G7"
   - Good: "President Trump arrived at the G7 summit in France. Heads of state are meeting to discuss Iran sanctions and Ukraine aid."
   - Never inject motive, emotion, or characterization that isn't in the source material.

2. SHOW BOTH SIDES AT THEIR BEST
   - If a political disagreement is part of the story, present each side as that side would present itself.
   - Republicans want X because [their reasoning, in their words]. Democrats want Y because [their reasoning, in their words].
   - NEVER use "claims," "alleges," "falsely asserts," "but critics note," or any rebuttal-while-explaining construction. Each side gets straight exposition.

3. CRIME IS CRIME, NOT POLITICS
   - If the story is about an indictment, charge, arrest, conviction, fraud, or similar -- desk it as CRIME.
   - Do not characterize the political affiliation, party, or ideology of anyone involved unless it is materially part of the charge.
   - "The senator from [state]" is fine. "[Party]-aligned" is not.

4. FEDERAL POLITICS MUST BE MONTANA-RELEVANT OR DON'T PUBLISH
   - National political churn that doesn't change anything for Montanans should NOT be synthesized.
   - If the only Montana angle is "the AP wire ran this in MT papers" -- refuse.
   - You can refuse by returning {"refuse": true, "reason": "..."}.
   - If a Montana representative (Tester, Daines, Gianforte, Zinke, Rosendale, Sheehy) is the subject, that IS the Montana angle -- write it focused on what they did, not the federal sausage-making around it.

5. NEUTRAL VOICE
   - No opinion adjectives ("controversial", "embattled", "stunning", "shocking", "long-overdue").
   - No emotional verbs without source backing ("slams", "blasts", "torches", "destroys").
   - Names, places, verbs, numbers. Active voice. Past or present tense as the facts dictate.

6. KEEP IT SHORT
   - Headline: 6-12 words. No clickbait, no questions, no ALL CAPS.
   - Body: 2-4 sentences. ~60-100 words total.
   - Don't summarize what sources said; tell readers what happened.

7. DESKING
   - Pick the single best desk from: city, business, crime, sports, health, entertainment, people, history.
   - "city" = governance, civic life, infrastructure, public services, weather, fires, accidents.
   - "business" = local commerce, openings/closings, economic data.
   - "crime" = anything criminal -- regardless of subject's profession.
   - "sports" = athletics. Including national finals only if Montanans are playing.
   - "health" = healthcare, public health, hospitals, medical news.
   - "entertainment" = arts, music, film, food, events.
   - "people" = profiles, obituaries, community figures.
   - "history" = anniversaries, retrospectives, archives.

OUTPUT FORMAT (strict JSON, no other text):

{
  "headline": "string",
  "body": "string",
  "desk": "one of: city, business, crime, sports, health, entertainment, people, history",
  "refuse": false
}

OR if the topic doesn't pass principle 4:

{
  "refuse": true,
  "reason": "string explaining why this should not be synthesized"
}
`;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
}

interface SynthesisOutput {
  headline?: string;
  body?: string;
  desk?: string;
  refuse?: boolean;
  reason?: string;
}

interface SourceExcerpt {
  storyId: number;
  sourceName: string;
  sourceUrl: string;
  headline: string;
  summary: string;
}

export interface SynthesizeResult {
  scanned: number;
  auto_published: number;
  queued_for_review: number;
  refused: number;
  errors: number;
}

/**
 * Call Gemini with a constructed prompt. Returns parsed JSON or throws.
 */
async function callGemini(
  apiKey: string,
  sources: SourceExcerpt[],
): Promise<SynthesisOutput> {
  const sourceBlock = sources
    .map(
      (s, i) =>
        `[Source ${i + 1}] ${s.sourceName}\nHeadline: ${s.headline}\nSummary: ${s.summary}\nURL: ${s.sourceUrl}\n`,
    )
    .join("\n");

  const userText = `Synthesize a single neutral story from these ${sources.length} Montana sources. Return strict JSON only.\n\n${sourceBlock}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2, // low temperature -> consistent, neutral phrasing
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no text");
  }
  let parsed: SynthesisOutput;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
  return parsed;
}

/**
 * Validate the parsed output. Returns true iff it passes our shape rules.
 */
function isValid(o: SynthesisOutput): o is {
  headline: string;
  body: string;
  desk: Desk;
  refuse: false;
} {
  if (o.refuse) return false;
  if (typeof o.headline !== "string" || o.headline.length < 5 || o.headline.length > 300) {
    return false;
  }
  if (typeof o.body !== "string" || o.body.length < 30 || o.body.length > 3000) {
    return false;
  }
  if (typeof o.desk !== "string" || !VALID_DESKS.includes(o.desk as Desk)) {
    return false;
  }
  return true;
}

/**
 * For one cluster: pull its source-story excerpts in order, return them.
 * Limited to MAX_SOURCES so the prompt stays cheap. Skips tweet-only members
 * (no article = no body to summarize).
 */
const MAX_SOURCES_PER_SYNTH = 5;

async function loadClusterSources(clusterId: number): Promise<SourceExcerpt[]> {
  const members = await db
    .select()
    .from(clusterMembers)
    .where(
      and(
        eq(clusterMembers.clusterId, clusterId),
        eq(clusterMembers.refType, "story"),
      ),
    );
  if (members.length === 0) return [];

  const storyIds = members
    .map((m) => Number(m.refId))
    .filter((n) => Number.isFinite(n));
  if (storyIds.length === 0) return [];

  const rows = await db
    .select({
      id: stories.id,
      headline: stories.headline,
      summary: stories.summary,
      sourceUrl: stories.sourceUrl,
      sourceName: stories.sourceName,
    })
    .from(stories)
    .where(inArray(stories.id, storyIds));

  return rows
    .slice(0, MAX_SOURCES_PER_SYNTH)
    .map((r) => ({
      storyId: r.id,
      sourceName: r.sourceName ?? "",
      sourceUrl: r.sourceUrl ?? "",
      headline: r.headline,
      summary: r.summary,
    }));
}

/**
 * Insert a synthesized story straight to the stories table. Used by the
 * auto_publish path.
 */
async function publishSynthesis(args: {
  cluster: Cluster;
  output: { headline: string; body: string; desk: Desk };
  sources: SourceExcerpt[];
}): Promise<number> {
  const now = new Date().toISOString();
  // The synthesis itself doesn't have a source URL of its own; we point
  // sourceUrl at ZooTown's own canonical "synthesis" path so any downstream
  // dedupe logic doesn't collide with the source articles.
  const synthUrl = `https://www.zootownhub.com/synthesis/cluster-${args.cluster.id}`;
  const created = await storage.createStory({
    headline: args.output.headline,
    summary: args.output.body,
    desk: args.output.desk as any,
    tags: JSON.stringify(["zootown-synthesis"]),
    sourceName: "ZooTown",
    sourceUrl: synthUrl,
    sourceType: "synthesis" as any,
    publishedAt: now,
    fetchedAt: now,
    location: null,
    cityId: args.cluster.cityId ?? null,
    modState: "approved" as any,
    onCalendar: false,
    isReviewed: true,
    reviewedAt: now,
    riskLevel: "low",
    isSeeded: false,
    isSynthesis: true,
    synthesizedFromIds: args.sources.map((s) => s.storyId) as any,
    clusterId: args.cluster.id,
  } as any);

  // Mark source stories so the public feed can hide them (the synthesis
  // displays them via the link rail; showing both would duplicate).
  if (args.sources.length > 0) {
    await db
      .update(stories)
      .set({ modState: "approved" as any })
      .where(inArray(stories.id, args.sources.map((s) => s.storyId)));
  }

  return created.id;
}

export async function runSynthesizer(): Promise<SynthesizeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const result: SynthesizeResult = {
    scanned: 0,
    auto_published: 0,
    queued_for_review: 0,
    refused: 0,
    errors: 0,
  };
  if (!apiKey) return result;

  // Pick eligible clusters: verdict is auto_publish or review, AND no
  // synthesis_story_id yet. Cap to 5 per tick so a slow LLM doesn't blow
  // the cron budget.
  const eligible = await db
    .select()
    .from(clusters)
    .where(
      and(
        sql`${clusters.verdict} IN ('auto_publish', 'review')`,
        isNull(clusters.synthesisStoryId),
      ),
    )
    .limit(5);
  result.scanned = eligible.length;
  if (eligible.length === 0) return result;

  for (const cluster of eligible) {
    const sources = await loadClusterSources(cluster.id);
    if (sources.length < 2) {
      // Cluster might be tweet-heavy with no article members yet -- skip.
      continue;
    }

    let output: SynthesisOutput;
    try {
      output = await callGemini(apiKey, sources);
    } catch (err: any) {
      console.error(`[synth] cluster ${cluster.id} Gemini call failed:`, err?.message ?? err);
      result.errors += 1;
      continue;
    }

    if (output.refuse) {
      // LLM refused (principle 4: federal politics not MT-relevant).
      await db
        .update(clusters)
        .set({
          verdict: "suppress" as any,
          verdictReason: `LLM refused: ${output.reason ?? "unspecified"}`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(clusters.id, cluster.id));
      result.refused += 1;
      continue;
    }

    if (!isValid(output)) {
      console.error(`[synth] cluster ${cluster.id} invalid Gemini output:`, output);
      result.errors += 1;
      continue;
    }

    if (cluster.verdict === "auto_publish") {
      try {
        const storyId = await publishSynthesis({
          cluster,
          output: {
            headline: output.headline!,
            body: output.body!,
            desk: output.desk as Desk,
          },
          sources,
        });
        await db
          .update(clusters)
          .set({
            synthesisStoryId: storyId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(clusters.id, cluster.id));
        result.auto_published += 1;
      } catch (err: any) {
        console.error(`[synth] cluster ${cluster.id} publish failed:`, err?.message ?? err);
        result.errors += 1;
      }
      continue;
    }

    // verdict === 'review' -> file into synthesis_queue
    try {
      await db
        .insert(synthesisQueue)
        .values({
          clusterId: cluster.id,
          headline: output.headline!,
          body: output.body!,
          desk: output.desk!,
          cityId: cluster.cityId,
          model: GEMINI_MODEL,
          sourceStoryIds: sources.map((s) => s.storyId) as any,
          status: "pending" as any,
          clusterDiversity: cluster.diversityScore as any,
          clusterMontana: cluster.montanaLocality as any,
          clusterPolitics: cluster.politicalToxicity as any,
          clusterAuthors: cluster.distinctAuthors,
        })
        .onConflictDoNothing();
      result.queued_for_review += 1;
    } catch (err: any) {
      console.error(`[synth] cluster ${cluster.id} queue insert failed:`, err?.message ?? err);
      result.errors += 1;
    }
  }

  return result;
}
