/**
 * Phase 16: anniversary surfacer.
 *
 * Runs once a day (early morning Mountain Time) and turns matching
 * historical_profiles rows into fresh People-desk stories.
 *
 * Two pathways:
 *
 *   1. Anniversary match — anyone whose anniversary_month+day == today, and
 *      who has not been surfaced already this calendar year.
 *   2. Slow-news-day fallback — for each city, if fewer than
 *      FALLBACK_THRESHOLD People-desk stories appeared in the last 24h, pick
 *      the oldest-last_surfaced_at fallback-eligible profile (city-specific
 *      first, then statewide) and surface that.
 *
 * Surfaced stories carry desk='people', sourceName='ZooTown History Desk',
 * and use the curated headline + body from the profile. Phase 15's relevance
 * scorer sees these as profiles via people_scope='regional' / 'state' /
 * 'community' depending on city_id.
 */
import { db } from "../storage.js";
import { sql } from "drizzle-orm";
import { storage } from "../storage.js";
import type { HistoricalProfile } from "../../shared/schema.js";

// If a city has FEWER than this many net-new People-desk stories in the
// past 24h, the surfacer fills in with a fallback profile.
const FALLBACK_THRESHOLD = 2;

// Mountain Time is the editorial clock; converting today's UTC instant to
// Mountain gives the right "today" for date matching, regardless of when
// the cron actually fires.
const ZOOTOWN_TZ = "America/Denver";

/** Returns {month, day, year} for "today" in Mountain Time. */
function todayInMountain(now: Date = new Date()): { month: number; day: number; year: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZOOTOWN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { month: get("month"), day: get("day"), year: get("year") };
}

/** Render a story headline from a profile, taking the curated headline verbatim. */
function profileHeadline(p: HistoricalProfile): string {
  return p.headline;
}

/** Map city_id -> people_scope hint. NULL city = state. */
function scopeForCityId(cityId: number | null): "regional" | "state" | "community" {
  if (cityId === null) return "state";
  // Billings and Missoula are the regional anchors per editorial.
  if (cityId === 1 || cityId === 2) return "regional";
  return "community";
}

/**
 * Find profiles whose anniversary matches today AND were not surfaced this
 * calendar year (in Mountain Time).
 */
async function pickAnniversaryProfiles(today: {
  month: number;
  day: number;
  year: number;
}): Promise<HistoricalProfile[]> {
  const rows = (await db.execute(sql`
    SELECT *
    FROM historical_profiles
    WHERE anniversary_month = ${today.month}
      AND anniversary_day   = ${today.day}
      AND (
        last_surfaced_at IS NULL
        OR EXTRACT(YEAR FROM (last_surfaced_at AT TIME ZONE ${ZOOTOWN_TZ})) < ${today.year}
      )
    ORDER BY anniversary_year ASC NULLS LAST
  `)) as unknown as any[];
  return rows.map(rowToProfile);
}

/**
 * For a given city, has the People desk had at least FALLBACK_THRESHOLD
 * fresh stories in the past 24h?
 */
async function peopleDeskHealthy(cityId: number): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM stories
    WHERE city_id = ${cityId}
      AND desk = 'people'
      AND published_at >= (NOW() - INTERVAL '24 hours')::text
      AND mod_state <> 'rejected'
  `)) as unknown as { n: number }[];
  const n = rows[0]?.n ?? 0;
  return n >= FALLBACK_THRESHOLD;
}

/**
 * Pick a fallback profile for the given city, preferring profiles tied to
 * that city, then statewide. Skips anything surfaced in the last 30 days.
 */
async function pickFallbackProfile(cityId: number): Promise<HistoricalProfile | null> {
  const rows = (await db.execute(sql`
    SELECT *
    FROM historical_profiles
    WHERE eligible_for_fallback = true
      AND (city_id = ${cityId} OR city_id IS NULL)
      AND (last_surfaced_at IS NULL OR last_surfaced_at < (NOW() - INTERVAL '30 days'))
    ORDER BY
      (CASE WHEN city_id = ${cityId} THEN 0 ELSE 1 END),
      last_surfaced_at ASC NULLS FIRST
    LIMIT 1
  `)) as unknown as any[];
  if (!rows[0]) return null;
  return rowToProfile(rows[0]);
}

function rowToProfile(r: any): HistoricalProfile {
  return {
    id: r.id,
    subjectName: r.subject_name,
    headline: r.headline,
    body: r.body,
    kind: r.kind,
    cityId: r.city_id,
    anniversaryMonth: r.anniversary_month,
    anniversaryDay: r.anniversary_day,
    anniversaryYear: r.anniversary_year,
    anniversaryKind: r.anniversary_kind,
    sourceUrls: r.source_urls ?? [],
    imageUrl: r.image_url,
    imageCredit: r.image_credit,
    tags: r.tags,
    lastSurfacedAt: r.last_surfaced_at,
    eligibleForFallback: r.eligible_for_fallback,
    createdAt: r.created_at,
  };
}

/**
 * Insert one profile as a fresh story on the People desk for the given
 * city. Returns the new story id, or null on duplicate.
 */
async function surfaceProfile(
  profile: HistoricalProfile,
  cityId: number,
  surfacedAt: string,
): Promise<number | null> {
  // Dedup by sourceUrl + city in case the surfacer somehow runs twice
  // before last_surfaced_at gets stamped.
  const synthUrl = `https://www.zootownhub.com/profile/${profile.id}?city=${cityId}&y=${surfacedAt.slice(0, 4)}`;
  const existing = (await db.execute(sql`
    SELECT id FROM stories
    WHERE source_url = ${synthUrl}
    LIMIT 1
  `)) as unknown as { id: number }[];
  if (existing[0]) return null;

  const scope = scopeForCityId(profile.cityId);
  const created = await storage.createStory({
    headline: profileHeadline(profile),
    summary: profile.body,
    desk: "people" as any,
    tags: JSON.stringify(["zootown-history-desk", profile.kind, profile.anniversaryKind]),
    sourceName: "ZooTown History Desk",
    sourceUrl: synthUrl,
    sourceType: "Official" as any,
    publishedAt: surfacedAt,
    fetchedAt: surfacedAt,
    location: null,
    cityId,
    modState: "approved" as any,
    onCalendar: false,
    isReviewed: true,
    reviewedAt: surfacedAt,
    riskLevel: "low",
    isSeeded: false,
    isSynthesis: false,
    // Phase 15 classifier outputs — already known, no need to re-classify.
    isPeopleProfile: true,
    peopleScope: scope as any,
    peopleSubject: profile.subjectName,
    classifierAt: surfacedAt,
    // Relevance starts at a profile baseline. The Phase-15 scorer will
    // recompute on the next 15-min tick and apply normal time decay.
    relevanceScore: scope === "regional" ? 80 : scope === "state" ? 72 : 65,
  } as any);
  return created.id;
}

async function markSurfaced(profileId: number, when: string) {
  await db.execute(sql`
    UPDATE historical_profiles
    SET last_surfaced_at = ${when}
    WHERE id = ${profileId}
  `);
}

async function listAllCityIds(): Promise<number[]> {
  const rows = (await db.execute(sql`SELECT id FROM cities ORDER BY id`)) as unknown as {
    id: number;
  }[];
  return rows.map((r) => r.id);
}

interface SurfacerReport {
  anniversariesSurfaced: number;
  fallbacksSurfaced: number;
  citiesChecked: number;
  citiesHealthy: number;
}

/**
 * Single run of the surfacer. Idempotent within a calendar day (Mountain
 * Time): anniversary profiles get last_surfaced_at stamped, fallback
 * profiles are debounced 30 days.
 */
export async function runAnniversarySurfacer(now: Date = new Date()): Promise<SurfacerReport> {
  const today = todayInMountain(now);
  const nowIso = now.toISOString();
  const allCityIds = await listAllCityIds();

  // --- Pathway 1: anniversaries ---
  const annivProfiles = await pickAnniversaryProfiles(today);
  let anniversariesSurfaced = 0;

  for (const profile of annivProfiles) {
    // Anniversary profiles surface to every city if statewide, else only
    // to their home city.
    const targets = profile.cityId === null ? allCityIds : [profile.cityId];
    let surfacedAny = false;
    for (const cid of targets) {
      const id = await surfaceProfile(profile, cid, nowIso);
      if (id !== null) {
        anniversariesSurfaced++;
        surfacedAny = true;
      }
    }
    if (surfacedAny) {
      await markSurfaced(profile.id, nowIso);
    }
  }

  // --- Pathway 2: slow-news-day fallback (per city) ---
  let citiesHealthy = 0;
  let fallbacksSurfaced = 0;

  for (const cityId of allCityIds) {
    const healthy = await peopleDeskHealthy(cityId);
    if (healthy) {
      citiesHealthy++;
      continue;
    }
    const profile = await pickFallbackProfile(cityId);
    if (!profile) continue;
    const id = await surfaceProfile(profile, cityId, nowIso);
    if (id !== null) {
      fallbacksSurfaced++;
      await markSurfaced(profile.id, nowIso);
    }
  }

  return {
    anniversariesSurfaced,
    fallbacksSurfaced,
    citiesChecked: allCityIds.length,
    citiesHealthy,
  };
}
