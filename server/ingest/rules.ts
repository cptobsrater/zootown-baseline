// Admin-managed classification rules applied at ingest time.
// Rules: set_desk (route), reject, set_kind (informational). Higher priority runs first.
import { storage } from "../storage";
import type { ClassificationRule, InsertStory, Source } from "@shared/schema";

let cache: ClassificationRule[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

export function invalidateRuleCache() {
  cache = null;
  cacheLoadedAt = 0;
}

function getRules(): ClassificationRule[] {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  cache = storage.listClassificationRules().filter((r) => r.active);
  cacheLoadedAt = now;
  return cache;
}

function matches(rule: ClassificationRule, story: InsertStory, source: Source | null): boolean {
  let haystack = "";
  switch (rule.matchField) {
    case "headline": haystack = story.headline ?? ""; break;
    case "summary": haystack = story.summary ?? ""; break;
    case "source": haystack = `${source?.name ?? story.sourceName ?? ""} ${source?.url ?? ""}`; break;
    case "text":
    default: haystack = `${story.headline ?? ""} ${story.summary ?? ""}`; break;
  }
  const hay = haystack.toLowerCase();
  const pat = rule.pattern.trim();
  if (pat.startsWith("/") && pat.length > 2) {
    const lastSlash = pat.lastIndexOf("/");
    if (lastSlash > 0) {
      try {
        const body = pat.slice(1, lastSlash);
        const flags = pat.slice(lastSlash + 1) || "i";
        return new RegExp(body, flags.includes("i") ? flags : flags + "i").test(hay);
      } catch {}
    }
  }
  return hay.includes(pat.toLowerCase());
}

export function applyClassificationRules(
  story: InsertStory,
  source: Source | null,
): { story: InsertStory; hits: number[] } {
  const rules = getRules();
  if (rules.length === 0) return { story, hits: [] };
  const next: InsertStory = { ...story };
  const hits: number[] = [];
  let deskOverridden = false;
  let rejected = false;
  for (const r of rules) {
    if (rejected) break;
    if (!matches(r, next, source)) continue;
    if (r.action === "set_desk" && !deskOverridden) {
      next.desk = r.value as InsertStory["desk"];
      deskOverridden = true;
      hits.push(r.id);
    } else if (r.action === "reject") {
      next.modState = "rejected";
      rejected = true;
      hits.push(r.id);
    } else if (r.action === "set_kind") {
      hits.push(r.id);
    }
  }
  return { story: next, hits };
}

export function bumpHitCounts(hits: number[]) {
  for (const id of hits) {
    try { storage.incrementRuleHitCount(id); } catch {}
  }
}
