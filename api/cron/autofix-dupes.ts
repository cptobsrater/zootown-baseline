/**
 * Standalone autofix endpoint - mostly for manual testing and as a recovery
 * path when the editorial-audit cron times out before autofix runs.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autofixDuplicates } from "../../server/learning/duplicate-autofix.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const report = await autofixDuplicates();
    res.json({ ok: true, ...report });
  } catch (err: any) {
    console.error("[cron/autofix-dupes] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
