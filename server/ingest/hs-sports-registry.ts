/**
 * Phase 18: hand-curated registry of Montana high school programs we track.
 *
 * Each entry is a city + school. The collector expands each school into N
 * (sport) rows in hs_teams on first boot.
 *
 * Editorial principle: one anchor school per smaller city, two-three in the
 * larger metros. Cody can extend later via admin UI.
 */
import type { InsertHsTeam, HS_SPORTS } from "../../shared/schema.js";

export interface SchoolSeed {
  cityId: number;
  schoolName: string;   // "Sentinel Spartans"
  shortName: string;    // "Sentinel"
  citySlug: string;     // MaxPreps slug
  schoolSlug: string;   // MaxPreps slug
  teamIdAlias?: string; // matches montana-teams.ts id when applicable
}

export const HS_SCHOOL_SEEDS: SchoolSeed[] = [
  // ---- Missoula (1) ----
  { cityId: 1, schoolName: "Sentinel Spartans", shortName: "Sentinel", citySlug: "missoula", schoolSlug: "sentinel-spartans" },
  { cityId: 1, schoolName: "Hellgate Knights", shortName: "Hellgate", citySlug: "missoula", schoolSlug: "hellgate-knights" },
  { cityId: 1, schoolName: "Big Sky Eagles", shortName: "Big Sky", citySlug: "missoula", schoolSlug: "big-sky-eagles" },

  // ---- Billings (2) ----
  { cityId: 2, schoolName: "Billings Senior Broncs", shortName: "Billings Senior", citySlug: "billings", schoolSlug: "billings-senior-broncs" },
  { cityId: 2, schoolName: "Billings West Golden Bears", shortName: "Billings West", citySlug: "billings", schoolSlug: "billings-west-golden-bears" },
  { cityId: 2, schoolName: "Billings Skyview Falcons", shortName: "Skyview", citySlug: "billings", schoolSlug: "skyview-falcons" },

  // ---- Great Falls (3) ----
  { cityId: 3, schoolName: "Great Falls Bison", shortName: "Great Falls", citySlug: "great-falls", schoolSlug: "great-falls-bison" },
  { cityId: 3, schoolName: "Great Falls CMR Rustlers", shortName: "CMR", citySlug: "great-falls", schoolSlug: "great-falls-cmr-rustlers" },

  // ---- Bozeman (4) ----
  { cityId: 4, schoolName: "Bozeman Hawks", shortName: "Bozeman", citySlug: "bozeman", schoolSlug: "bozeman-hawks" },
  { cityId: 4, schoolName: "Bozeman Gallatin Raptors", shortName: "Gallatin", citySlug: "bozeman", schoolSlug: "gallatin-raptors" },

  // ---- Butte (5) ----
  { cityId: 5, schoolName: "Butte Bulldogs", shortName: "Butte", citySlug: "butte", schoolSlug: "butte-bulldogs" },
  { cityId: 5, schoolName: "Butte Central Maroons", shortName: "Butte Central", citySlug: "butte", schoolSlug: "butte-central-catholic-maroons" },

  // ---- Helena (6) ----
  { cityId: 6, schoolName: "Helena Bengals", shortName: "Helena", citySlug: "helena", schoolSlug: "helena-bengals" },
  { cityId: 6, schoolName: "Helena Capital Bruins", shortName: "Capital", citySlug: "helena", schoolSlug: "helena-capital-bruins" },

  // ---- Kalispell (7) ----
  { cityId: 7, schoolName: "Flathead Braves", shortName: "Flathead", citySlug: "kalispell", schoolSlug: "flathead-braves-bravettes" },
  { cityId: 7, schoolName: "Glacier Wolfpack", shortName: "Glacier", citySlug: "kalispell", schoolSlug: "glacier-wolfpack" },

  // ---- Havre (8) ----
  { cityId: 8, schoolName: "Havre Blue Ponies", shortName: "Havre", citySlug: "havre", schoolSlug: "havre-blue-ponies" },

  // ---- Whitefish (9) ----
  { cityId: 9, schoolName: "Whitefish Bulldogs", shortName: "Whitefish", citySlug: "whitefish", schoolSlug: "whitefish-bulldogs" },

  // ---- Laurel (10) ----
  { cityId: 10, schoolName: "Laurel Locomotives", shortName: "Laurel", citySlug: "laurel", schoolSlug: "laurel-locomotives" },
];

// Which sports we ingest for every school. The collector silently skips
// any school+sport combo whose MaxPreps page returns no current-season
// data, so listing all of them is cheap.
export const HS_SPORTS_TO_INGEST: (typeof HS_SPORTS)[number][] = [
  "football",
  "basketball",
  "basketball-girls",
  "volleyball",
  "baseball",
  "softball",
  "wrestling",
  "soccer",
  "soccer-girls",
];

/** Cross product all schools x all sports. */
export function expandSeed(): Omit<InsertHsTeam, "createdAt" | "lastPolledAt">[] {
  const rows: Omit<InsertHsTeam, "createdAt" | "lastPolledAt">[] = [];
  for (const s of HS_SCHOOL_SEEDS) {
    for (const sport of HS_SPORTS_TO_INGEST) {
      rows.push({
        cityId: s.cityId,
        schoolName: s.schoolName,
        shortName: s.shortName,
        citySlug: s.citySlug,
        schoolSlug: s.schoolSlug,
        sport,
        level: "hs_varsity",
        teamIdAlias: (s.teamIdAlias ?? null) as any,
        isActive: true,
      });
    }
  }
  return rows;
}
