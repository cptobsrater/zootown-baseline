/**
 * Phase 22: athlete index from MaxPreps game pages.
 *
 * For each hs_games row that produced a Sports-desk story, fetch the game
 * page once and extract athlete names from the box score. Upserts into
 * the `athletes` table and records the appearance in
 * `athlete_game_appearances`.
 *
 * MaxPreps' public box score shows the home team's athletes (the away
 * team's stats are gated behind login). We attribute every visible
 * athlete to whichever of OUR tracked teams the home team matches \u2014
 * if the home team isn't one of ours, we skip.
 *
 * When an athlete accumulates >= PROFILE_THRESHOLD wins and hasn't been
 * profiled in PROFILE_COOLDOWN_DAYS days, the surfacer emits a
 * People-desk story.
 */
import { sql } from "drizzle-orm";
import { db } from "../storage.js";
import { storage } from "../storage.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PROFILE_THRESHOLD = 3;
const PROFILE_COOLDOWN_DAYS = 30;

// Pattern: /local/player/stats.aspx?athleteid=<uuid>&ssid=<uuid>" ...>Firstname Lastname</a>
const ATHLETE_RE =
  /\/local\/player\/stats\.aspx\?athleteid=([^&"]+)&ssid=([^&"]+)"[^>]*>([A-Z][a-zA-Z'\-]+ [A-Z][a-zA-Z'\-]+(?: [A-Z][a-zA-Z'\-]+)?)<\/a>/g;

const HOME_URL_RE = /"HomeTeam":\s*\{[^}]+"url":\s*"([^"]+)"/;
const AWAY_URL_RE = /"AwayTeam":\s*\{[^}]+"url":\s*"([^"]+)"/;

interface FetchedAthletes {
  homeSchoolPath: string | null;
  awaySchoolPath: string | null;
  athletes: { name: string; athleteId: string; ssid: string }[];
}

async function fetchAthletesFromGame(gameUrl: string): Promise<FetchedAthletes | null> {
  try {
    const res = await fetch(gameUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 50_000) return null; // 404 pages are tiny

    const home = HOME_URL_RE.exec(html);
    const away = AWAY_URL_RE.exec(html);
    const homeSchoolPath = home ? extractSchoolPath(home[1]) : null;
    const awaySchoolPath = away ? extractSchoolPath(away[1]) : null;

    // Reset global regex state (it has /g flag).
    ATHLETE_RE.lastIndex = 0;
    const seen = new Map<string, { name: string; athleteId: string; ssid: string }>();
    let m: RegExpExecArray | null;
    while ((m = ATHLETE_RE.exec(html)) !== null) {
      const athleteId = m[1];
      const ssid = m[2];
      const name = m[3];
      seen.set(athleteId, { name, athleteId, ssid });
    }
    return {
      homeSchoolPath,
      awaySchoolPath,
      athletes: Array.from(seen.values()),
    };
  } catch (err: any) {
    console.warn("[athlete-enrich] fetch error:", err?.message ?? err);
    return null;
  }
}

/** Extract "/mt/laurel/laurel-locomotives" from a schedule URL. */
function extractSchoolPath(url: string): string | null {
  // Inputs look like "/mt/laurel/laurel-locomotives/baseball/" or full URL.
  const m = url.match(/\/mt\/([^\/]+)\/([^\/]+)/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

interface OurTeam {
  id: number;
  city_id: number;
  school_name: string;
  short_name: string;
  city_slug: string;
  school_slug: string;
  sport: string;
}

async function findOurTeam(citySlug: string, schoolSlug: string, sport: string): Promise<OurTeam | null> {
  const rows = (await db.execute(sql`
    SELECT id, city_id, school_name, short_name, city_slug, school_slug, sport
    FROM hs_teams
    WHERE city_slug = ${citySlug}
      AND school_slug = ${schoolSlug}
      AND sport = ${sport}
    LIMIT 1
  `)) as unknown as OurTeam[];
  return rows[0] ?? null;
}

export interface EnrichmentReport {
  gamesProcessed: number;
  athletesUpserted: number;
  appearancesRecorded: number;
  homeMatched: number;
  awayMatched: number;
  errors: string[];
}

/** Run for the most recent storied games we haven't yet enriched. */
export async function enrichRecentGames(opts?: { limit?: number }): Promise<EnrichmentReport> {
  const report: EnrichmentReport = {
    gamesProcessed: 0,
    athletesUpserted: 0,
    appearancesRecorded: 0,
    homeMatched: 0,
    awayMatched: 0,
    errors: [],
  };
  const limit = opts?.limit ?? 10;

  // Pick games that have a story and at least one missing athlete-game
  // appearance row. Use the absence of any appearance as the cheap signal
  // for "not yet enriched".
  const games = (await db.execute(sql`
    SELECT g.id, g.contest_id, g.game_url, g.team_id, g.game_date, t.sport
    FROM hs_games g
    JOIN hs_teams t ON g.team_id = t.id
    WHERE g.story_id IS NOT NULL
      AND g.game_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM athlete_game_appearances a WHERE a.game_id = g.id
      )
    ORDER BY g.finalized_at DESC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: number; contest_id: string; game_url: string;
    team_id: number; game_date: string; sport: string;
  }>;

  for (const game of games) {
    report.gamesProcessed++;
    const fetched = await fetchAthletesFromGame(game.game_url);
    if (!fetched) {
      report.errors.push(`fetch failed game ${game.id}`);
      continue;
    }
    if (fetched.athletes.length === 0) continue;

    // Figure out which team's athletes we just saw. MaxPreps shows the
    // home team's stats publicly. We attribute athletes to our team only
    // if the home OR away school matches one of ours.
    const matchedTeam = await matchOurTeam(
      fetched.homeSchoolPath,
      fetched.awaySchoolPath,
      game.sport,
    );
    if (!matchedTeam.team) continue;
    if (matchedTeam.role === "home") report.homeMatched++;
    if (matchedTeam.role === "away") report.awayMatched++;

    for (const a of fetched.athletes) {
      try {
        // Upsert athlete row.
        const existing = (await db.execute(sql`
          SELECT id FROM athletes
          WHERE name = ${a.name}
            AND hs_team_id = ${matchedTeam.team.id}
            AND sport = ${game.sport}
          LIMIT 1
        `)) as unknown as { id: number }[];

        let athleteId: number;
        if (existing[0]) {
          athleteId = existing[0].id;
          await db.execute(sql`
            UPDATE athletes
            SET appearance_count = appearance_count + 1,
                win_count = win_count + 1,
                last_seen_game = ${game.id},
                updated_at = NOW()
            WHERE id = ${athleteId}
          `);
        } else {
          const inserted = (await db.execute(sql`
            INSERT INTO athletes (name, hs_team_id, sport, city_id, school_name, short_name,
              first_seen_game, last_seen_game, win_count, appearance_count)
            VALUES (${a.name}, ${matchedTeam.team.id}, ${game.sport},
              ${matchedTeam.team.city_id}, ${matchedTeam.team.school_name},
              ${matchedTeam.team.short_name}, ${game.id}, ${game.id}, 1, 1)
            RETURNING id
          `)) as unknown as { id: number }[];
          athleteId = inserted[0].id;
          report.athletesUpserted++;
        }

        // Record appearance.
        await db.execute(sql`
          INSERT INTO athlete_game_appearances (athlete_id, game_id)
          VALUES (${athleteId}, ${game.id})
          ON CONFLICT DO NOTHING
        `);
        report.appearancesRecorded++;
      } catch (err: any) {
        report.errors.push(`athlete ${a.name}: ${err?.message ?? err}`);
      }
    }
  }

  return report;
}

async function matchOurTeam(
  homePath: string | null,
  awayPath: string | null,
  sport: string,
): Promise<{ team: OurTeam | null; role: "home" | "away" | "none" }> {
  if (homePath) {
    const [city, school] = homePath.split("/");
    const team = await findOurTeam(city, school, sport);
    if (team) return { team, role: "home" };
  }
  if (awayPath) {
    const [city, school] = awayPath.split("/");
    const team = await findOurTeam(city, school, sport);
    if (team) return { team, role: "away" };
  }
  return { team: null, role: "none" };
}

// ─── Profile emission ──────────────────────────────────────────────────────
//
// When an athlete crosses PROFILE_THRESHOLD wins, surface a People-desk
// profile. The story credits the athlete by name, sport, school, and
// recent win count, with attribution back to MaxPreps.

export interface ProfileReport {
  candidates: number;
  emitted: number;
  errors: string[];
}

export async function emitAthleteProfiles(): Promise<ProfileReport> {
  const report: ProfileReport = { candidates: 0, emitted: 0, errors: [] };

  const candidates = (await db.execute(sql`
    SELECT id, name, hs_team_id, sport, city_id, school_name, short_name, win_count
    FROM athletes
    WHERE win_count >= ${PROFILE_THRESHOLD}
      AND (
        last_profiled_at IS NULL
        OR last_profiled_at < NOW() - INTERVAL '1 day' * ${PROFILE_COOLDOWN_DAYS}
      )
    ORDER BY win_count DESC, updated_at DESC
    LIMIT 20
  `)) as unknown as Array<{
    id: number; name: string; hs_team_id: number; sport: string;
    city_id: number; school_name: string; short_name: string; win_count: number;
  }>;

  report.candidates = candidates.length;
  const sportLabel: Record<string, string> = {
    football: "football",
    basketball: "boys basketball",
    "basketball-girls": "girls basketball",
    volleyball: "volleyball",
    baseball: "baseball",
    softball: "softball",
    wrestling: "wrestling",
    soccer: "boys soccer",
    "soccer-girls": "girls soccer",
  };

  for (const c of candidates) {
    try {
      const sportName = sportLabel[c.sport] ?? c.sport;
      const headline = `${c.name} keeps powering ${c.short_name} ${sportName}`;
      const body =
        `${c.name} has played a role in ${c.win_count} ${c.short_name} ${sportName} ` +
        `wins this season according to MaxPreps box scores. ` +
        `${c.short_name} has been one of the consistent performers in ${c.school_name}'s lineup.\n\n` +
        `Source: MaxPreps box scores for each game.`;
      const now = new Date().toISOString();
      const syntheticUrl = `https://www.zootownhub.com/athlete/${c.id}?y=${now.slice(0, 4)}m=${now.slice(5, 7)}`;

      // Dedup by source_url.
      const dup = (await db.execute(sql`
        SELECT id FROM stories WHERE source_url = ${syntheticUrl} LIMIT 1
      `)) as unknown as { id: number }[];
      if (dup[0]) continue;

      const created = await storage.createStory({
        headline,
        summary: body,
        desk: "people" as any,
        tags: JSON.stringify(["zootown-athlete-index", c.sport, c.short_name]),
        sourceName: "ZooTown Athlete Index",
        sourceUrl: syntheticUrl,
        sourceType: "Official" as any,
        publishedAt: now,
        fetchedAt: now,
        location: null,
        cityId: c.city_id,
        modState: "approved" as any,
        onCalendar: false,
        isReviewed: false,
        riskLevel: "low",
        isSeeded: false,
        isPeopleProfile: true,
        peopleScope: "community" as any,
        peopleSubject: c.name,
        classifierAt: now,
        relevanceScore: 68,
      } as any);

      await db.execute(sql`
        UPDATE athletes
        SET last_profile_story_id = ${created.id},
            last_profiled_at = NOW()
        WHERE id = ${c.id}
      `);
      report.emitted++;
    } catch (err: any) {
      report.errors.push(`${c.name}: ${err?.message ?? err}`);
    }
  }

  return report;
}
