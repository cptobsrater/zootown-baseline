/**
 * Relevance scorer (Phase 15).
 *
 * The home feed orders by relevance_score DESC, published_at DESC.
 * Stories at the top look identical to stories further down; only their
 * POSITION signals collective value. The classifier outputs drive the
 * score; this module composes them with a time-decay curve so wins decay
 * over ~24h, obituaries over ~72h, and ordinary news over ~6h.
 *
 * The scorer is intentionally a pure function (story -> score) so we can:
 *   - re-score every story on a recurring cron (decay over time)
 *   - re-run on demand after classifier updates
 *   - reason about why a story is where it is in the feed
 *
 * SCORING STRUCTURE
 *
 *   base = starting score by content type
 *     - sports recap with MT win:
 *         pro=95  d1=92  d2_naia=80  jc_club=75  hs_varsity=72
 *     - people profile:
 *         national=90  regional=80  state=72  community=65
 *     - obituary: 70 (with a slower decay)
 *     - breaking news (high-signal source): 60
 *     - synthesis story: 50
 *     - regular news: 40
 *     - calendar event: 30
 *     - sports recap, MT only-lost: 35 (still posted, NOT elevated)
 *     - sub-varsity sports: 25 (always reported, never elevated)
 *
 *   decay = (1 - age_hours / half_life_hours), clamped to [0.05, 1]
 *     - wins: half_life = 24h
 *     - obituaries: half_life = 72h
 *     - profiles: half_life = 24h
 *     - regular news: half_life = 6h
 *     - calendar events: half_life = 168h (one week pre-event)
 *
 *   final_score = base * decay
 *
 *   Two natural side effects of this design:
 *   - National-stage achievement (90) beats D-I win (92)? No -- pro/D-I wins
 *     get a small celebration ceiling raise to 95/92 so a Griz win
 *     outranks a national lawyer award on the same day. National
 *     achievements still beat HS wins and routine news.
 *   - Personal profile + sports cross-post: the same story carries both
 *     base flags; we take the MAX of the two base values.
 */
import type { SportsLevel } from "./montana-teams.js";
import type { PeopleScope } from "./people-classifier.js";

export interface ScoreInput {
  publishedAt: string;
  // Sports
  isSportsRecap?: boolean;
  hasLocalWin?: boolean;
  sportsLevel?: SportsLevel | null;
  // People
  isPeopleProfile?: boolean;
  peopleScope?: PeopleScope | null;
  // Other content types
  isObituary?: boolean;
  isSynthesis?: boolean;
  onCalendar?: boolean;
  startsAt?: string | null;
  // Source flagging -- breaking-news quality sources get a small lift
  sourceType?: string | null;
}

const HOUR = 60 * 60 * 1000;

function ageHours(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const delta = Date.now() - t;
  return Math.max(0, delta / HOUR);
}

function decayCurve(ageH: number, halfLifeH: number): number {
  // Linear-ish decay from 1.0 -> 0.05 over half_life_h, then floor at 0.05
  // so old stories never disappear entirely (they're just at the bottom).
  if (ageH <= 0) return 1;
  const v = 1 - ageH / halfLifeH;
  return Math.max(0.05, Math.min(1, v));
}

const WIN_BASE: Record<SportsLevel, number> = {
  pro: 95,
  d1: 92,
  d2_naia: 80,
  jc_club: 75,
  hs_varsity: 72,
  sub_varsity: 30, // ingested but never elevated
};

const PROFILE_BASE: Record<PeopleScope, number> = {
  national: 90,
  regional: 80,
  state: 72,
  community: 65,
};

export interface ScoreBreakdown {
  base: number;
  decay: number;
  score: number;
  category: string;
  halfLifeH: number;
}

/**
 * Pure score function. Returns the breakdown so we can debug / display
 * why a story sits where it sits.
 */
export function scoreStory(s: ScoreInput): ScoreBreakdown {
  const ageH = ageHours(s.publishedAt);

  // Pick the highest base across all categories that fire for this story.
  // Each category also carries its own half-life; we use the category that
  // WON the base-max as the half-life owner. That keeps the model simple:
  // one curve per story, the curve of the story's strongest identity.
  let base = 40; // baseline news
  let halfLifeH = 6;
  let category = "news";

  // Sports recap, with a Montana team winning -- the celebration case.
  if (s.isSportsRecap && s.hasLocalWin && s.sportsLevel) {
    const lvl = s.sportsLevel;
    const b = WIN_BASE[lvl] ?? 40;
    if (b > base) {
      base = b;
      halfLifeH = 24;
      category = `sports_win_${lvl}`;
    }
  }
  // Sports recap with no MT win (only-lost case). Still posted, NOT elevated.
  if (s.isSportsRecap && !s.hasLocalWin) {
    if (s.sportsLevel === "sub_varsity") {
      if (25 > base) { base = 25; halfLifeH = 12; category = "sports_subvarsity"; }
    } else {
      if (35 > base) { base = 35; halfLifeH = 12; category = "sports_loss_or_neutral"; }
    }
  }

  // People profile.
  if (s.isPeopleProfile && s.peopleScope) {
    const b = PROFILE_BASE[s.peopleScope] ?? 40;
    if (b > base) {
      base = b;
      halfLifeH = 24;
      category = `people_profile_${s.peopleScope}`;
    }
  }

  // Obituaries -- meaningful, longer decay.
  if (s.isObituary) {
    if (70 > base) {
      base = 70;
      halfLifeH = 72;
      category = "obituary";
    }
  }

  // Synthesis stories sit slightly above ordinary news.
  if (s.isSynthesis && base <= 50) {
    base = 50;
    halfLifeH = 8;
    category = "synthesis";
  }

  // Calendar events get a long, gentle decay -- they're forward-looking,
  // not historical, so the curve is keyed off how soon the event starts
  // rather than how long ago it was published.
  if (s.onCalendar && s.startsAt) {
    const startsMs = Date.parse(s.startsAt);
    if (Number.isFinite(startsMs)) {
      const hoursUntil = Math.max(0, (startsMs - Date.now()) / HOUR);
      // Events within 24h get a small bump; events more than a week out
      // sit lower in the feed (still browsable, just not the top).
      const eventBase = hoursUntil <= 24 ? 55 : hoursUntil <= 72 ? 45 : 30;
      if (eventBase > base) {
        base = eventBase;
        halfLifeH = 168; // a week
        category = "calendar_event";
      }
    }
  }

  const decay = decayCurve(ageH, halfLifeH);
  const score = Math.round((base * decay) * 100) / 100;
  return { base, decay, score, category, halfLifeH };
}
