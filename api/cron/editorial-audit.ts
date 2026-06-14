/**
 * Vercel Cron -> daily editorial audit (Phase 17).
 *
 * Runs once a day, scans the last 48h of stories, and writes findings to
 * editorial_audits. Findings dedupe by (kind, fingerprint) so a re-run
 * never piles up duplicates.
 *
 * Schedule: 06:30 MT (= 12:30 UTC standard, 13:30 UTC DST) — half an hour
 * after the anniversary surfacer so its newly-created stories also get
 * scanned in the morning pass.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runEditorialAudit } from "../../server/learning/editorial-audit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const report = await runEditorialAudit();
    res.json({ ok: true, ...report });
  } catch (err: any) {
    console.error("[cron/editorial-audit] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
