/**
 * Sports-recap classifier (Phase 15).
 *
 * Detects whether a story is a Montana sports recap, and if so which
 * teams won and lost. The output drives the relevance scorer: when a MT
 * team wins, the story gets elevated for ~24h. When the only MT team in
 * the recap loses, the story remains in the feed but does NOT get elevated.
 *
 * Pipeline:
 *   1. Reject quickly if no MT team alias appears in headline+summary.
 *   2. Look for a result verb in the headline ("defeats", "falls to",
 *      "edges", "rallies past", etc.) -- absent => probably a preview or
 *      schedule, not a recap.
 *   3. Look for a score line ("35-14", "21-7") as a strong recap signal.
 *   4. From the verb + team positions, decide who won and who lost.
 *   5. Compute the highest pro/college/HS level among the matched teams.
 *
 * Heuristic-only -- no Gemini call. The downstream scorer is the layer
 * that has to be cheap and run at high frequency. Misclassifications get
 * caught by a future review pass + human admin tooling.
 */
import { findTeamsInText, maxLevel, type MontanaTeam, type SportsLevel } from "./montana-teams.js";

export interface SportsClassification {
  isSportsRecap: boolean;
  /** Team-ids of MT teams that WON the matchup (may be empty even for a recap). */
  teamsWon: string[];
  /** Team-ids of MT teams that LOST the matchup. */
  teamsLost: string[];
  /** Highest pro-tier level present among the matched teams (drives ranking). */
  level: SportsLevel | null;
  /** True if at least one MT team won. Drives elevation eligibility. */
  hasLocalWin: boolean;
  /** Reason string for debug -- mostly empty on the hot path. */
  reason?: string;
}

// Words that pair with "Subject [verb] Object" meaning Subject won.
const WIN_VERBS = [
  "defeats", "defeat", "defeated",
  "beats", "beat",
  "tops", "topped",
  "edges", "edged",
  "downs", "downed",
  "routs", "routed",
  "trounces", "trounced",
  "rally past", "rallies past", "rallied past",
  "rally to beat", "rallies to beat", "rallied to beat",
  "crush", "crushes", "crushed",
  "thump", "thumps", "thumped",
  "sweep", "sweeps", "swept",
  "take down", "takes down", "took down",
  "hold off", "hands defeat to",
  "clinch", "clinches", "clinched",
  "capture", "captures", "captured",
  "outlasts", "outlasted",
  "blanks", "blanked",
  "shuts out", "shut out",
  "knocks off", "knocked off",
  "holds off", "held off",
  "advances past", "advanced past",
  "stuns", "stunned",
  "upsets", "upset",
  "overcomes", "overcame",
  "win over", "wins over", "won over",
  "victory over", "win against",
  "claim victory over",
];
// Words that pair with "Subject [verb] Object" meaning Subject LOST.
const LOSS_VERBS = [
  "falls to", "fell to",
  "loses to", "lost to",
  "drops to", "dropped to",
  "bows to", "bowed to",
  "drops decision to",
  "swept by",
  "blanked by",
  "shut out by",
  "knocked out by",
  "upset by",
  "loss to", "loss against",
];
// Words that suggest "this is a recap, not a preview/schedule".
const RECAP_HINTS = [
  /\b\d{1,3}\s*[-\u2013]\s*\d{1,3}\b/, // "35-14" or with en-dash
  /\bfinal\s*:/i,
  /\bscore[d]?\b/i,
  /\b(first|second|third|fourth)\s+quarter\b/i,
  /\b(overtime|OT|double overtime)\b/i,
  /\binnings?\b/i,
  /\bgoals?\b/i,
  /\bpoints?\b/i,
  /\btouchdowns?\b/i,
  /\bhomers?|home runs?\b/i,
];
const PREVIEW_HINTS = [
  /\bwill (?:host|play|face|take on|travel)\b/i,
  /\bare set to\b/i,
  /\bpreview\b/i,
  /\bsneak peek\b/i,
  /\bscheduled to\b/i,
  /\b(tonight|tomorrow|this week|this weekend)\b.*\bgame\b/i,
];

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** Find the byte index of the FIRST occurrence of any phrase in `text`. */
function firstIndexOfAny(text: string, phrases: string[]): { idx: number; phrase: string } | null {
  let best: { idx: number; phrase: string } | null = null;
  for (const p of phrases) {
    const i = text.indexOf(p);
    if (i < 0) continue;
    if (!best || i < best.idx) best = { idx: i, phrase: p };
  }
  return best;
}

export function classifySports(input: {
  headline: string;
  summary?: string | null;
  body?: string | null;
  desk?: string | null;
}): SportsClassification {
  const empty: SportsClassification = {
    isSportsRecap: false,
    teamsWon: [],
    teamsLost: [],
    level: null,
    hasLocalWin: false,
  };

  const headline = input.headline ?? "";
  const summary = input.summary ?? "";
  const text = `${headline}. ${summary}`;
  const lc = text.toLowerCase();

  // Fast reject: no MT team mentioned at all.
  const teams = findTeamsInText(text);
  if (teams.length === 0) return empty;

  // Recap vs. preview vs. neither.
  const hasRecapHint = RECAP_HINTS.some((re) => re.test(text));
  const hasPreviewHint = PREVIEW_HINTS.some((re) => re.test(text));
  const headlineLc = headline.toLowerCase();
  const winHit = firstIndexOfAny(headlineLc, WIN_VERBS) ?? firstIndexOfAny(lc, WIN_VERBS);
  const lossHit = firstIndexOfAny(headlineLc, LOSS_VERBS) ?? firstIndexOfAny(lc, LOSS_VERBS);

  // Not a recap unless we have either a verb hit OR a clear recap hint
  // (score line / quarter / inning).
  if (!winHit && !lossHit && !hasRecapHint) {
    // Could still be a recap if desk is sports + score-like number; otherwise
    // we treat as non-recap (preview, profile, schedule).
    if (!hasRecapHint && hasPreviewHint) return empty;
    if (!hasRecapHint) return empty;
  }

  // Roll up the level across all matched teams.
  let level: SportsLevel | null = null;
  for (const t of teams) level = maxLevel(level, t.level);

  // Determine winners / losers. Strategy: find the result verb's position,
  // partition teams by which side they fall on. Subject is BEFORE the verb,
  // object is AFTER. Some verbs are subject-WINS ("defeats"), others are
  // subject-LOSES ("falls to").
  let subjectWinsVerbIdx = winHit?.idx ?? -1;
  let subjectLosesVerbIdx = lossHit?.idx ?? -1;
  // Use whichever appears first in the headline.
  let pivotIdx = -1;
  let subjectWins = true;
  if (subjectWinsVerbIdx >= 0 && (subjectLosesVerbIdx < 0 || subjectWinsVerbIdx < subjectLosesVerbIdx)) {
    pivotIdx = subjectWinsVerbIdx;
    subjectWins = true;
  } else if (subjectLosesVerbIdx >= 0) {
    pivotIdx = subjectLosesVerbIdx;
    subjectWins = false;
  }

  const teamsWon: string[] = [];
  const teamsLost: string[] = [];

  if (pivotIdx >= 0) {
    // Find team positions in the lowercased combined text.
    for (const team of teams) {
      // Best-effort position via the first alias hit.
      let teamIdx = -1;
      for (const alias of team.aliases) {
        const i = lc.indexOf(alias.toLowerCase());
        if (i >= 0 && (teamIdx < 0 || i < teamIdx)) teamIdx = i;
      }
      if (teamIdx < 0) continue;
      // Pivot is in the headline; team positions may be in summary too.
      // Treat headline-only positioning -- if both teams are in headline,
      // use that ordering; otherwise fall back to combined text.
      const beforePivot = teamIdx < pivotIdx;
      const wins = (beforePivot && subjectWins) || (!beforePivot && !subjectWins);
      if (wins) teamsWon.push(team.id);
      else teamsLost.push(team.id);
    }
  } else if (hasRecapHint) {
    // Recap with no result verb -- can't reliably attribute. Mark as
    // recap but with empty winner/loser lists; downstream scorer will
    // treat it as a non-celebratable recap.
  }

  const hasLocalWin = teamsWon.length > 0;
  return {
    isSportsRecap: true,
    teamsWon,
    teamsLost,
    level,
    hasLocalWin,
  };
}
