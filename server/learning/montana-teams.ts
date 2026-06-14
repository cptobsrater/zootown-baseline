/**
 * Montana sports team registry (Phase 15).
 *
 * The sports classifier matches headlines and body text against these
 * entries to figure out (a) is this a Montana sports recap at all, (b)
 * which team(s) won, (c) which team(s) lost, (d) what level was the game.
 *
 * Each team has aliases -- the strings a journalist might use to refer
 * to it. Order them most-specific first so partial matches don't pick
 * the wrong team (e.g. "Bobcats" alone could be MSU OR Skyview High; MSU
 * appears first so it wins ties when no other context is available).
 *
 * `level` drives ranking when multiple wins land on the same day:
 *   pro        > pro / independent professional (Pioneer League etc.)
 *   d1         > Division I college (Griz, Bobcats)
 *   d2_naia    > D-II / NAIA (Carroll, Tech, MSU-Billings, etc.)
 *   jc_club    > junior college / club / adult elite
 *   hs_varsity > high school varsity
 *   sub_varsity > JV, freshman teams (ingested but never elevated)
 *
 * `cityScope` controls which city feeds the story shows on:
 *   "statewide" -- shows on all 10 city feeds (Griz/Bobcats, Mustangs etc.)
 *   "city:<slug>" -- shows only on that one city's feed (every HS team)
 */
export type SportsLevel = "pro" | "d1" | "d2_naia" | "jc_club" | "hs_varsity" | "sub_varsity";

export interface MontanaTeam {
  id: string;
  displayName: string;
  /** Strings a headline/body might use. Case-insensitive. Order matters: longer + more specific first. */
  aliases: string[];
  level: SportsLevel;
  /** "statewide" for college/pro teams. "city:<slug>" for HS / community teams. */
  cityScope: "statewide" | `city:${string}`;
  /** Optional list of sports the team fields. Empty = treat as all sports. */
  sports?: string[];
}

// City slugs used in citySlug column elsewhere in the codebase:
//   missoula, billings, greatfalls, bozeman, butte, helena, kalispell,
//   havre, whitefish, laurel
export const MONTANA_TEAMS: MontanaTeam[] = [
  // ===== Pro / minor league =====
  {
    id: "billings-mustangs",
    displayName: "Billings Mustangs",
    aliases: ["Billings Mustangs", "Mustangs"],
    level: "pro",
    cityScope: "statewide",
    sports: ["baseball"],
  },
  {
    id: "missoula-paddleheads",
    displayName: "Missoula PaddleHeads",
    aliases: ["Missoula PaddleHeads", "PaddleHeads", "Paddle Heads"],
    level: "pro",
    cityScope: "statewide",
    sports: ["baseball"],
  },
  {
    id: "glacier-range-riders",
    displayName: "Glacier Range Riders",
    aliases: ["Glacier Range Riders", "Range Riders"],
    level: "pro",
    cityScope: "statewide",
    sports: ["baseball"],
  },

  // ===== D-I college =====
  {
    id: "montana-grizzlies",
    displayName: "Montana Grizzlies",
    aliases: [
      "Montana Grizzlies",
      "Lady Griz",
      "Grizzlies",
      "Griz",
      "University of Montana",
      "UM Grizzlies",
    ],
    level: "d1",
    cityScope: "statewide",
  },
  {
    id: "montana-state-bobcats",
    displayName: "Montana State Bobcats",
    aliases: [
      "Montana State Bobcats",
      "Lady Cats",
      "Bobcats",
      "Cats",
      "MSU Bobcats",
      "Montana State",
      "MSU",
    ],
    level: "d1",
    cityScope: "statewide",
  },

  // ===== D-II / NAIA =====
  {
    id: "carroll-saints",
    displayName: "Carroll College Saints",
    aliases: ["Carroll College Saints", "Carroll Saints", "Carroll College", "Carroll"],
    level: "d2_naia",
    cityScope: "city:helena",
  },
  {
    id: "montana-tech-orediggers",
    displayName: "Montana Tech Orediggers",
    aliases: ["Montana Tech Orediggers", "Tech Orediggers", "Orediggers", "Montana Tech", "MT Tech"],
    level: "d2_naia",
    cityScope: "city:butte",
  },
  {
    id: "msu-northern-lights",
    displayName: "MSU-Northern Lights",
    aliases: ["MSU-Northern Lights", "MSU Northern Lights", "MSU-Northern", "Northern Lights"],
    level: "d2_naia",
    cityScope: "city:havre",
  },
  {
    id: "msu-billings-yellowjackets",
    displayName: "MSU Billings Yellowjackets",
    aliases: ["MSU Billings Yellowjackets", "MSU-Billings", "MSU Billings", "Yellowjackets"],
    level: "d2_naia",
    cityScope: "city:billings",
  },
  {
    id: "um-western-bulldogs",
    displayName: "UM-Western Bulldogs",
    aliases: ["UM-Western Bulldogs", "Montana Western", "UM Western", "Western Bulldogs"],
    level: "d2_naia",
    cityScope: "statewide",
  },
  {
    id: "rocky-mountain-bears",
    displayName: "Rocky Mountain College Bears",
    aliases: ["Rocky Mountain College Bears", "Rocky Mountain Bears", "Rocky Mountain College", "Battlin' Bears"],
    level: "d2_naia",
    cityScope: "city:billings",
  },
  {
    id: "providence-argos",
    displayName: "University of Providence Argos",
    aliases: ["University of Providence Argos", "UP Argos", "Providence Argos", "Argos"],
    level: "d2_naia",
    cityScope: "city:greatfalls",
  },
  {
    id: "great-falls-flathead-valley-cc",
    displayName: "Flathead Valley CC",
    aliases: ["Flathead Valley Community College", "Flathead Valley CC", "FVCC"],
    level: "jc_club",
    cityScope: "city:kalispell",
  },

  // ===== High School varsity =====
  // Billings (city:billings)
  { id: "billings-senior",      displayName: "Billings Senior Broncs",  aliases: ["Billings Senior Broncs", "Senior High Broncs", "Senior Broncs", "Billings Senior", "Senior High"], level: "hs_varsity", cityScope: "city:billings" },
  { id: "billings-west",        displayName: "Billings West Golden Bears", aliases: ["Billings West Golden Bears", "West Golden Bears", "Billings West", "West High"], level: "hs_varsity", cityScope: "city:billings" },
  { id: "billings-skyview",     displayName: "Billings Skyview Falcons", aliases: ["Billings Skyview Falcons", "Skyview Falcons", "Billings Skyview", "Skyview"], level: "hs_varsity", cityScope: "city:billings" },
  { id: "billings-central",     displayName: "Billings Central Rams",    aliases: ["Billings Central Rams", "Central Rams", "Billings Central"], level: "hs_varsity", cityScope: "city:billings" },
  // Missoula (city:missoula)
  { id: "missoula-hellgate",    displayName: "Missoula Hellgate Knights", aliases: ["Missoula Hellgate Knights", "Hellgate Knights", "Missoula Hellgate", "Hellgate"], level: "hs_varsity", cityScope: "city:missoula" },
  { id: "missoula-sentinel",    displayName: "Missoula Sentinel Spartans", aliases: ["Missoula Sentinel Spartans", "Sentinel Spartans", "Missoula Sentinel", "Sentinel"], level: "hs_varsity", cityScope: "city:missoula" },
  { id: "missoula-big-sky",     displayName: "Missoula Big Sky Eagles",  aliases: ["Missoula Big Sky Eagles", "Big Sky Eagles", "Missoula Big Sky"], level: "hs_varsity", cityScope: "city:missoula" },
  { id: "missoula-loyola",      displayName: "Missoula Loyola Sacred Heart Breakers", aliases: ["Missoula Loyola Sacred Heart Breakers", "Loyola Sacred Heart", "Missoula Loyola", "Loyola Breakers"], level: "hs_varsity", cityScope: "city:missoula" },
  // Great Falls (city:greatfalls)
  { id: "great-falls-cmr",      displayName: "C.M. Russell Rustlers",    aliases: ["C.M. Russell Rustlers", "CMR Rustlers", "CM Russell", "C.M. Russell", "CMR", "Rustlers"], level: "hs_varsity", cityScope: "city:greatfalls" },
  { id: "great-falls-high",     displayName: "Great Falls High Bison",   aliases: ["Great Falls High Bison", "GFH Bison", "Great Falls High", "GFH"], level: "hs_varsity", cityScope: "city:greatfalls" },
  { id: "great-falls-central",  displayName: "Great Falls Central Mustangs", aliases: ["Great Falls Central Mustangs", "GFCC Mustangs", "Great Falls Central"], level: "hs_varsity", cityScope: "city:greatfalls" },
  // Bozeman (city:bozeman)
  { id: "bozeman-high",         displayName: "Bozeman High Hawks",       aliases: ["Bozeman High Hawks", "Bozeman Hawks", "Bozeman High"], level: "hs_varsity", cityScope: "city:bozeman" },
  { id: "bozeman-gallatin",     displayName: "Bozeman Gallatin Raptors", aliases: ["Bozeman Gallatin Raptors", "Gallatin Raptors", "Gallatin High"], level: "hs_varsity", cityScope: "city:bozeman" },
  // Butte (city:butte)
  { id: "butte-high",           displayName: "Butte High Bulldogs",      aliases: ["Butte High Bulldogs", "Butte Bulldogs", "Butte High"], level: "hs_varsity", cityScope: "city:butte" },
  { id: "butte-central",        displayName: "Butte Central Maroons",    aliases: ["Butte Central Maroons", "Butte Central", "BC Maroons"], level: "hs_varsity", cityScope: "city:butte" },
  // Helena (city:helena)
  { id: "helena-high",          displayName: "Helena High Bengals",      aliases: ["Helena High Bengals", "Helena Bengals", "Helena High"], level: "hs_varsity", cityScope: "city:helena" },
  { id: "helena-capital",       displayName: "Helena Capital Bruins",    aliases: ["Helena Capital Bruins", "Capital Bruins", "Helena Capital"], level: "hs_varsity", cityScope: "city:helena" },
  // Kalispell (city:kalispell)
  { id: "flathead-braves",      displayName: "Flathead Braves",          aliases: ["Flathead Braves", "Flathead High", "Kalispell Flathead"], level: "hs_varsity", cityScope: "city:kalispell" },
  { id: "glacier-wolfpack",     displayName: "Glacier Wolfpack",         aliases: ["Glacier Wolfpack", "Glacier High", "Kalispell Glacier"], level: "hs_varsity", cityScope: "city:kalispell" },
  // Whitefish (city:whitefish)
  { id: "whitefish-bulldogs",   displayName: "Whitefish Bulldogs",       aliases: ["Whitefish Bulldogs", "Whitefish High"], level: "hs_varsity", cityScope: "city:whitefish" },
  // Havre (city:havre)
  { id: "havre-blue-ponies",    displayName: "Havre Blue Ponies",        aliases: ["Havre Blue Ponies", "Blue Ponies", "Havre High"], level: "hs_varsity", cityScope: "city:havre" },
  // Laurel (city:laurel)
  { id: "laurel-locomotives",   displayName: "Laurel Locomotives",       aliases: ["Laurel Locomotives", "Laurel High"], level: "hs_varsity", cityScope: "city:laurel" },
];

// Pre-built index from lowercase alias -> team. Built once at module load.
const ALIAS_INDEX: Array<{ alias: string; team: MontanaTeam }> = (() => {
  const entries: Array<{ alias: string; team: MontanaTeam }> = [];
  for (const team of MONTANA_TEAMS) {
    for (const alias of team.aliases) {
      entries.push({ alias: alias.toLowerCase(), team });
    }
  }
  // Sort by alias length descending so longer aliases match first (avoids
  // "MSU" eating "MSU-Northern").
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
})();

const LEVEL_RANK: Record<SportsLevel, number> = {
  pro: 5,
  d1: 4,
  d2_naia: 3,
  jc_club: 2,
  hs_varsity: 1,
  sub_varsity: 0,
};

/** Returns the higher of two levels (used to roll up a multi-team recap). */
export function maxLevel(a: SportsLevel | null | undefined, b: SportsLevel | null | undefined): SportsLevel | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Find every Montana team referenced in `text` (headline + summary, etc).
 * Uses word-boundary matching, longest aliases first to disambiguate
 * "Bobcats" (MSU) from "Skyview Falcons" etc. Returns a deduped array of
 * teams in order of first occurrence.
 */
export function findTeamsInText(text: string): MontanaTeam[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  // Mark which character ranges have been consumed so a shorter alias
  // doesn't double-match inside a longer one (e.g. "Tech" inside "Tech
  // Orediggers").
  const consumed = new Array<boolean>(lower.length).fill(false);
  const found = new Map<string, { team: MontanaTeam; firstIdx: number }>();
  for (const entry of ALIAS_INDEX) {
    let startSearch = 0;
    // Find all non-overlapping matches of this alias.
    while (true) {
      const idx = lower.indexOf(entry.alias, startSearch);
      if (idx < 0) break;
      // Skip if any character in the candidate range is already consumed.
      let isConsumed = false;
      for (let i = idx; i < idx + entry.alias.length; i++) {
        if (consumed[i]) { isConsumed = true; break; }
      }
      if (!isConsumed) {
        // Word-boundary guard: the char before and after must be non-alpha.
        const before = idx > 0 ? lower[idx - 1] : "";
        const after = idx + entry.alias.length < lower.length ? lower[idx + entry.alias.length] : "";
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          for (let i = idx; i < idx + entry.alias.length; i++) consumed[i] = true;
          const existing = found.get(entry.team.id);
          if (!existing || idx < existing.firstIdx) {
            found.set(entry.team.id, { team: entry.team, firstIdx: idx });
          }
        }
      }
      startSearch = idx + entry.alias.length;
    }
  }
  return Array.from(found.values())
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .map((x) => x.team);
}

export function getTeamById(id: string): MontanaTeam | undefined {
  return MONTANA_TEAMS.find((t) => t.id === id);
}
