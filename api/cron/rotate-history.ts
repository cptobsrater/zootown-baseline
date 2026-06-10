/**
 * Vercel Cron → weekly history/people visible-window rotation.
 * Schedule: once a week (see vercel.json).
 * Picks ~100 articles per desk to surface on the public site.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rotationTick } from "../../server/history";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    await rotationTick();
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[cron/rotate-history] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
