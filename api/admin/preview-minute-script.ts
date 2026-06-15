/**
 * GET /api/admin/preview-minute-script
 *
 * Generates tonight's ZooTown News script using the top-5 Missoula stories
 * (last 7 days) and returns the markdown anchor script. Does NOT call HeyGen.
 *
 * For each story we fetch the source article body and pass it to the script
 * generator so claims can be attributed precisely. Source = the original
 * outlet (Missoulian, KPAX, etc) - never zootownhub.com.
 *
 * Auth: CRON_SECRET bearer.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "drizzle-orm";
import { db } from "../../server/storage.js";
import {
  generateZootownMinuteScript,
  type ScriptStoryInput,
} from "../../server/learning/zootown-minute-script.js";

const MISSOULA_CITY_ID = 1;

async function fetchArticleBody(url: string, timeoutMs = 5000): Promise<string> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "ZooTown-News/1.0 (+https://www.zootownhub.com; editorial research)",
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const html = await res.text();
    // Very simple extractor: strip scripts/styles, keep text from <p> tags.
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    const paragraphs = Array.from(stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim())
      .filter((t) => t.length > 40); // drop nav/footer fragments
    return paragraphs.slice(0, 12).join("\n\n").slice(0, 4000);
  } catch {
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const windowStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const rows = (await db.execute(sql`
      WITH draft_counts AS (
        SELECT story_id, COUNT(*)::int AS approved_drafts
        FROM story_drafts WHERE status = 'approved' AND source_of_change <> 'snapshot'
        GROUP BY story_id
      )
      SELECT
        s.id, s.headline, s.summary, s.source_name, s.source_url, s.published_at, s.desk,
        COALESCE(sa.like_count, 0) - COALESCE(sa.dislike_count, 0)
          - (COALESCE(sa.report_count, 0) * 5)
          + (COALESCE(dc.approved_drafts, 0) * 3) AS score
      FROM stories s
      LEFT JOIN signal_aggregates sa ON sa.story_id = s.id
      LEFT JOIN draft_counts dc ON dc.story_id = s.id
      WHERE s.mod_state = 'approved'
        AND s.city_id = ${MISSOULA_CITY_ID}
        AND s.published_at > ${windowStart}
        AND s.desk NOT IN ('health')
      ORDER BY score DESC, published_at DESC
      LIMIT 5
    `)) as unknown as Array<{
      id: number; headline: string; summary: string | null;
      source_name: string; source_url: string;
      published_at: string; desk: string; score: number;
    }>;

    if (rows.length === 0) {
      return res.status(200).json({ error: "no Missoula stories in last 7 days" });
    }

    // Fetch each source article body in parallel.
    const bodies = await Promise.all(rows.map((r) => fetchArticleBody(r.source_url)));

    const categoryByDesk: Record<string, string> = {
      city: "civic",
      business: "civic",
      crime: "safety",
      sports: "sports",
      entertainment: "community",
      people: "community",
      history: "community",
    };

    const inputs: ScriptStoryInput[] = rows.map((r, i) => ({
      id: r.id,
      headline: r.headline,
      summary: r.summary ?? "",
      source_name: r.source_name,
      source_url: r.source_url,
      published_at: r.published_at,
      category: categoryByDesk[r.desk] || "general",
      article_body: bodies[i],
    }));

    const result = await generateZootownMinuteScript(inputs);

    res.json({
      anchor: result.anchor_name,
      stories: rows.map((r, i) => ({
        id: r.id,
        headline: r.headline,
        source_name: r.source_name,
        source_url: r.source_url,
        score: r.score,
        article_body_chars: bodies[i].length,
      })),
      word_count: result.word_count,
      estimated_seconds: result.estimated_seconds,
      target_window: { min: 280, max: 360, wpm: 150 },
      attempts_used: result.attempts,
      validator_warnings: result.warnings,
      finish_reason: result.finish_reason,
      raw_response_chars: result.raw_chars,
      script_markdown: result.script,
    });
  } catch (err: any) {
    console.error("[preview-minute-script]", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
