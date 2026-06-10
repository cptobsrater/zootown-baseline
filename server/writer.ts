/**
 * Daily long-form writer.
 *
 * Strategy: pulls from a curated content bank (people-bank.ts, history-bank.ts).
 * The bank holds ~300-word articles authored once; the daily scheduler picks
 * the next unused one for the requested desk and inserts it as a fresh post.
 *
 * Why a bank rather than runtime LLM calls?
 * - Deterministic output the admin reviewed up front.
 * - Works identically in dev and the published *.pplx.app sandbox (LLM API
 *   credentials are not available in published sites).
 * - Admin can edit/delete any article from the backend after publish.
 *
 * Restocking: when the bank is exhausted, the writer returns null and the
 * daily scheduler logs a warning. Admin can either add more entries to the
 * banks or write articles directly from /admin → History Pool.
 */
import { storage } from "./storage";
import { PEOPLE_BANK } from "./people-bank";
import { HISTORY_BANK } from "./history-bank";

export interface DraftArticle {
  headline: string;
  body: string;          // markdown
  kind: "history" | "profile" | "obituary";
  sourceUrl?: string;    // Wikipedia or archive link (cited as Reference)
}

function existingHeadlines(desk: "people" | "history"): Set<string> {
  return new Set(
    storage
      .listAllHistoryStoriesForDesk(desk)
      .map((s) => s.headline.toLowerCase().trim()),
  );
}

export async function generateNextArticle(
  desk: "people" | "history",
): Promise<DraftArticle | null> {
  const bank = desk === "people" ? PEOPLE_BANK : HISTORY_BANK;
  const used = existingHeadlines(desk);
  const next = bank.find((a) => !used.has(a.headline.toLowerCase().trim()));
  if (!next) return null;
  return next;
}
