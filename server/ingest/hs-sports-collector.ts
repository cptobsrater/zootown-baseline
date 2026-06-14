/**
 * Phase 18: MaxPreps high-school sports collector.
 *
 * For each row in hs_teams, fetch the schedule page, extract SportsEvent
 * objects from the embedded JSON-LD, upsert into hs_games, and emit a
 * stories row whenever OUR team wins a game we haven't already storied.
 *
 * Editorial rules baked in:
 *   - Wins only (Cody: "no recap a loss").
 *   - HS varsity is the only level we ingest here — same-day pro/college
 *     wins still outrank HS via Phase 15 sports_level tie-breaker.
 *   - City attribution comes from hs_teams.city_id, not from the
 *     opponent's city — Laurel cares about Laurel.
 *
 * Discovery: the collector reads SportsEvent's `description` (e.g. "On
 * 5/12, the Laurel varsity baseball team won their away conference game
 * against Sidney (MT) by a score of 14-4.") and extracts:
 *   - did OUR team win?
 *   - what was the score?
 *   - was it a home/away/conference/playoff game?
 *
 * The English template is stable across all sports — MaxPreps generates
 * it from the same backend.
 */
import { db } from "../storage.js";
import { storage } from "../storage.js";
import { sql, eq } from "drizzle-orm";
import { hsTeams, hsGames } from "../../shared/schema.js";
import type { HsTeam } from "../../shared/schema.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// "25-26" style season slug. MaxPreps uses the school-year span.
//
// Rule: if today's month is July or later, season starts THIS year; else
// last year. So June 14, 2026 -> "25-26". August 5, 2026 -> "26-27".
function currentSeasonSlug(now: Date = new Date()): string {
  const m = now.getMonth() + 1;
  const y = now.getFullYear() % 100;
  const startYy = m >= 7 ? y : y - 1;
  const endYy = startYy + 1;
  return `${String(startYy).padStart(2, "0")}-${String(endYy).padStart(2, "0")}`;
}

function scheduleUrl(team: HsTeam, season: string): string {
  return `https://www.maxpreps.com/mt/${team.citySlug}/${team.schoolSlug}/${team.sport}/${season}/schedule/`;
}

interface ParsedEvent {
  contestId: string;
  startDateIso: string;
  gameDate: string;       // YYYY-MM-DD
  name: string;
  description: string;
  url: string;
}

/** Find SportsEvent JSON objects embedded in MaxPreps HTML. */
function extractSportsEvents(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const needle = '"@type":"SportsEvent"';
  let i = 0;
  while (true) {
    const pos = html.indexOf(needle, i);
    if (pos < 0) break;
    // walk back to the opening brace
    let start = pos;
    while (start > 0 && html[start] !== "{") start--;
    // brace-balanced walk forward
    let depth = 0;
    let j = start;
    let inStr = false;
    let esc = false;
    while (j < html.length) {
      const ch = html[j];
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = !inStr;
      else if (!inStr) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      j++;
    }
    try {
      const obj = JSON.parse(html.slice(start, j));
      const url = String(obj.url ?? "");
      const m = url.match(/c=([^&]+)/);
      const contestId = m ? m[1] : "";
      const startDateIso = String(obj.startDate ?? obj.endDate ?? "");
      const gameDate = startDateIso.slice(0, 10);
      if (contestId && gameDate) {
        events.push({
          contestId,
          startDateIso,
          gameDate,
          name: String(obj.name ?? ""),
          description: String(obj.description ?? ""),
          url,
        });
      }
    } catch {
      // skip malformed
    }
    i = j;
  }
  return events;
}

/**
 * Parse a MaxPreps description string to extract win/loss/score from
 * OUR team's perspective. Returns null when the game isn't final yet.
 */
interface GameOutcome {
  isFinal: boolean;
  ourScore: number | null;
  oppScore: number | null;
  result: "W" | "L" | "T" | null;
  isHome: boolean | null;
  isPlayoff: boolean;
  isConference: boolean;
  opponentName: string;
}

// Detect "No result has been reported".
const UNREPORTED_RE = /no result has been reported/i;

// Two flavors of description sentence:
//
//   "On 5/12, the Laurel varsity baseball team won their away conference
//    game against Sidney (MT) by a score of 14-4."
//   "On 4/14, the Billings Central Catholic varsity baseball team won
//    their away conference game against Laurel (MT) by a score of ..."
//
// The first sentence subject can be EITHER our team or the opponent.
// We disambiguate by checking which name matches the school we polled.
// Positional groups (ES5 compatible):
//   1 = subject ("Laurel", "Billings Central Catholic", etc.)
//   2 = verb (won|lost|tied)
//   3 = location (home|away|neutral) — may be empty
//   4 = gametype (conference|non-conference|playoff|regular|etc.) — may be empty
//   5 = opponent name
//   6 = subject's score
//   7 = opponent's score (from subject's perspective)
const RESULT_RE =
  /On [0-9/]+,?\s+the\s+(.+?)\s+varsity\s+[\w-]+\s+team\s+(won|lost|tied)\s+their\s+(home|away|neutral)?\s*([\w-]+)?\s*game\s+(?:against|with)\s+([^.]+?)\s+by\s+a\s+score\s+of\s+(\d+)\s*[-\u2013]\s*(\d+)/i;

function parseDescription(
  desc: string,
  ourShortName: string,
  ourSchoolName: string,
): GameOutcome | null {
  if (UNREPORTED_RE.test(desc)) {
    return {
      isFinal: false,
      ourScore: null,
      oppScore: null,
      result: null,
      isHome: null,
      isPlayoff: /playoff/i.test(desc),
      isConference: /conference/i.test(desc),
      opponentName: "",
    };
  }
  const m = RESULT_RE.exec(desc);
  if (!m) return null;
  const subject = (m[1] ?? "").trim();
  const verb = (m[2] ?? "").toLowerCase();
  const location = (m[3] ?? "").toLowerCase();
  const gametype = (m[4] ?? "").toLowerCase();
  const opponent = (m[5] ?? "").replace(/\s*\(MT\)$/i, "").trim();
  const a = Number(m[6]);
  const b = Number(m[7]);

  // Did OUR team appear as the subject?
  const subjLow = subject.toLowerCase();
  const sLow = ourShortName.toLowerCase();
  const fullLow = ourSchoolName.toLowerCase();
  const ourIsSubject =
    subjLow === sLow ||
    subjLow.startsWith(sLow + " ") ||
    sLow.startsWith(subjLow + " ") ||
    fullLow.includes(subjLow) ||
    subjLow.includes(sLow);

  // MaxPreps score convention: "by a score of {winner_score}-{loser_score}"
  // ALWAYS, regardless of who's the subject. So a=winner, b=loser.
  const winnerScore = a;
  const loserScore = b;
  const subjectWon = verb === "won";
  const isTie = verb === "tied";

  let result: "W" | "L" | "T" | null = null;
  let ourScore: number | null = null;
  let oppScore: number | null = null;
  let isHome: boolean | null = null;
  let opponentName = opponent;

  if (ourIsSubject) {
    // OUR team is the subject of the sentence.
    ourScore = isTie ? winnerScore : subjectWon ? winnerScore : loserScore;
    oppScore = isTie ? loserScore : subjectWon ? loserScore : winnerScore;
    result = subjectWon ? "W" : isTie ? "T" : "L";
    isHome = location === "home";
  } else {
    // Opponent is the subject. Their result flips for us.
    opponentName = subject;
    ourScore = isTie ? winnerScore : subjectWon ? loserScore : winnerScore;
    oppScore = isTie ? loserScore : subjectWon ? winnerScore : loserScore;
    result = subjectWon ? "L" : isTie ? "T" : "W";
    // Subject's "home" location means opponent is at home, we're away.
    isHome = location === "home" ? false : location === "away" ? true : null;
  }

  return {
    isFinal: true,
    ourScore,
    oppScore,
    result,
    isHome,
    isPlayoff: /playoff/i.test(gametype) || /playoff/i.test(desc),
    isConference: /conference/i.test(gametype) || /conference/i.test(desc),
    opponentName,
  };
}

/** Headline composer for a Montana HS win. Phase-15 sports recap, varsity. */
function buildHeadline(team: HsTeam, outcome: GameOutcome): string {
  const sport = sportLabel(team.sport);
  const tag = outcome.isPlayoff
    ? "playoff "
    : outcome.isConference
    ? "conference "
    : "";
  return `${team.shortName} ${sport} ${tag}wins ${outcome.ourScore}-${outcome.oppScore} over ${outcome.opponentName}`;
}

function sportLabel(sport: string): string {
  switch (sport) {
    case "football": return "football";
    case "basketball": return "boys basketball";
    case "basketball-girls": return "girls basketball";
    case "volleyball": return "volleyball";
    case "soccer": return "boys soccer";
    case "soccer-girls": return "girls soccer";
    case "baseball": return "baseball";
    case "softball": return "softball";
    case "wrestling": return "wrestling";
    default: return sport;
  }
}

async function fetchSchedule(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (!res.ok) {
      console.warn(`[hs-collector] ${url} -> ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn(`[hs-collector] ${url} fetch failed:`, err?.message ?? err);
    return null;
  }
}

interface CollectorReport {
  teamsPolled: number;
  gamesObserved: number;
  gamesFinalized: number;
  storiesEmitted: number;
  errors: string[];
}

/** Single tick of the collector — walks every active hs_team row. */
export async function runHsSportsCollector(opts?: {
  limit?: number;
  onlyTeamId?: number;
}): Promise<CollectorReport> {
  const report: CollectorReport = {
    teamsPolled: 0,
    gamesObserved: 0,
    gamesFinalized: 0,
    storiesEmitted: 0,
    errors: [],
  };

  const limit = opts?.limit ?? 50;
  const teams = (await db.execute(sql`
    SELECT * FROM hs_teams
    WHERE is_active = true
    ${opts?.onlyTeamId ? sql`AND id = ${opts.onlyTeamId}` : sql``}
    ORDER BY last_polled_at ASC NULLS FIRST
    LIMIT ${limit}
  `)) as unknown as any[];

  const season = currentSeasonSlug();

  for (const tRaw of teams) {
    const team: HsTeam = rowToTeam(tRaw);
    report.teamsPolled++;
    const url = scheduleUrl(team, season);
    const html = await fetchSchedule(url);
    if (!html) {
      report.errors.push(`fetch ${team.schoolName}/${team.sport}`);
      continue;
    }
    const events = extractSportsEvents(html);
    for (const ev of events) {
      report.gamesObserved++;
      try {
        const outcome = parseDescription(ev.description, team.shortName, team.schoolName);
        if (!outcome) continue;

        // Upsert into hs_games. The contest_id is globally unique.
        const existing = (await db.execute(sql`
          SELECT id, is_final, story_id FROM hs_games WHERE contest_id = ${ev.contestId} LIMIT 1
        `)) as unknown as { id: number; is_final: boolean; story_id: number | null }[];

        let gameId: number;
        let alreadyFinal = false;
        let alreadyStoried = false;
        if (existing[0]) {
          gameId = existing[0].id;
          alreadyFinal = existing[0].is_final;
          alreadyStoried = existing[0].story_id !== null;
          // Update final state if it just became final.
          if (!alreadyFinal && outcome.isFinal) {
            await db.execute(sql`
              UPDATE hs_games SET
                is_final = ${outcome.isFinal},
                team_score = ${outcome.ourScore},
                opponent_score = ${outcome.oppScore},
                result = ${outcome.result},
                is_home = ${outcome.isHome},
                finalized_at = NOW(),
                opponent_name = ${outcome.opponentName || ev.name}
              WHERE id = ${gameId}
            `);
            report.gamesFinalized++;
          }
        } else {
          const inserted = (await db.execute(sql`
            INSERT INTO hs_games
              (contest_id, team_id, game_date, opponent_name, is_home, is_final,
               team_score, opponent_score, result, game_url, finalized_at)
            VALUES (
              ${ev.contestId}, ${team.id}, ${ev.gameDate},
              ${outcome.opponentName || ev.name}, ${outcome.isHome},
              ${outcome.isFinal}, ${outcome.ourScore}, ${outcome.oppScore},
              ${outcome.result}, ${ev.url},
              ${outcome.isFinal ? sql`NOW()` : null}
            )
            RETURNING id
          `)) as unknown as { id: number }[];
          gameId = inserted[0].id;
          if (outcome.isFinal) report.gamesFinalized++;
        }

        // Emit a story for wins we haven't storied yet.
        // Freshness gate: only post wins from the last 14 days. On first boot
        // when we observe a whole season at once, we don't want to dump 50+
        // ancient game stories into the feed.
        const ageDays = (Date.now() - Date.parse(ev.gameDate)) / 86400000;
        if (outcome.isFinal && outcome.result === "W" && !alreadyStoried && ageDays <= 14 && ageDays >= -1) {
          const headline = buildHeadline(team, outcome);
          const body = `${team.shortName} won ${outcome.ourScore}-${outcome.oppScore} over ${outcome.opponentName} on ${formatPretty(ev.gameDate)}.${outcome.isPlayoff ? " Playoff game." : outcome.isConference ? " Conference game." : ""}\n\nFull box score: ${ev.url}`;
          const nowIso = new Date().toISOString();
          const created = await storage.createStory({
            headline,
            summary: body,
            desk: "sports" as any,
            tags: JSON.stringify(["zootown-hs-sports", team.sport, team.shortName]),
            sourceName: "MaxPreps",
            sourceUrl: ev.url,
            sourceType: "Official" as any,
            publishedAt: nowIso,
            fetchedAt: nowIso,
            location: null,
            cityId: team.cityId,
            modState: "approved" as any,
            onCalendar: false,
            isReviewed: false,
            riskLevel: "low",
            isSeeded: false,
            isSynthesis: false,
            // Phase 15 classifier outputs — we already know what this is.
            isSportsRecap: true,
            sportsTeamsWon: [team.teamIdAlias ?? team.schoolSlug] as any,
            sportsTeamsLost: [] as any,
            sportsLevel: "hs_varsity" as any,
            classifierAt: nowIso,
            relevanceScore: 72,
          } as any);
          await db.execute(sql`
            UPDATE hs_games SET story_id = ${created.id} WHERE id = ${gameId}
          `);
          report.storiesEmitted++;
        }
      } catch (err: any) {
        report.errors.push(`${team.schoolName}/${ev.contestId}: ${err?.message ?? err}`);
      }
    }

    await db.execute(sql`UPDATE hs_teams SET last_polled_at = NOW() WHERE id = ${team.id}`);
  }
  return report;
}

function rowToTeam(r: any): HsTeam {
  return {
    id: r.id,
    cityId: r.city_id,
    schoolName: r.school_name,
    shortName: r.short_name,
    citySlug: r.city_slug,
    schoolSlug: r.school_slug,
    sport: r.sport,
    level: r.level,
    teamIdAlias: r.team_id_alias,
    isActive: r.is_active,
    lastPolledAt: r.last_polled_at,
    createdAt: r.created_at,
  };
}

function formatPretty(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** First-boot seeding from the curated registry. Idempotent. */
export async function seedHsTeamsIfEmpty(): Promise<{ inserted: number; skipped: number }> {
  const { expandSeed } = await import("./hs-sports-registry.js");
  const rows = expandSeed();
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = (await db.execute(sql`
      SELECT id FROM hs_teams WHERE school_slug = ${r.schoolSlug} AND sport = ${r.sport} LIMIT 1
    `)) as unknown as { id: number }[];
    if (existing[0]) { skipped++; continue; }
    await db.insert(hsTeams).values(r as any);
    inserted++;
  }
  return { inserted, skipped };
}
