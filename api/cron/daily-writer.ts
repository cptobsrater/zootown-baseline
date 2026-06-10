/**
 * Vercel Cron → daily long-form writer.
 * Schedule: once a day (see vercel.json).
 * Picks the next article from people-bank or history-bank, alternating desks.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dailyWriteTick } from "../../server/history";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    await dailyWriteTick();
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[cron/daily-writer] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
