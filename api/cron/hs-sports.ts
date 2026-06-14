/**
 * Vercel Cron -> Phase 18 HS sports collector.
 *
 * Runs a few times a day to catch new game results. MaxPreps doesn't
 * expose RSS so we walk per-school schedule pages. With ~22 schools x
 * ~9 sports = 200 polls, conservative pacing keeps us safe.
 *
 * Schedule: 4x/day at 30-min past each peak window (10:30, 14:30, 19:30,
 * 23:30 UTC = 4:30 AM, 8:30 AM, 1:30 PM, 5:30 PM Mountain). Most game
 * results post within an hour of a game ending; evening polls catch
 * day games, morning poll catches anything stragglers reported overnight.
 *
 * Budget: 120 seconds. The collector is rate-friendly (sequential
 * fetches with no parallelism by default) — each school is ~1s wallclock.
 *
 * First call automatically seeds hs_teams from the curated registry if
 * the table is empty.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runHsSportsCollector, seedHsTeamsIfEmpty } from "../../server/ingest/hs-sports-collector.js";
import { db } from "../../server/storage.js";
import { sql } from "drizzle-orm";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const out: any = { ok: true };
  try {
    const rows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM hs_teams`)) as unknown as { n: number }[];
    if ((rows[0]?.n ?? 0) === 0) {
      out.seed = await seedHsTeamsIfEmpty();
    }
  } catch (err: any) {
    out.seedError = String(err?.message ?? err);
  }

  try {
    const limit = Number(req.query.limit ?? 50);
    const onlyTeamId = req.query.team ? Number(req.query.team) : undefined;
    out.report = await runHsSportsCollector({ limit, onlyTeamId });
  } catch (err: any) {
    out.error = String(err?.message ?? err);
    return res.status(500).json(out);
  }

  res.json(out);
}
