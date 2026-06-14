# Historical Profiles Seed Spec

The output target is a TypeScript file at
`/home/user/workspace/zootown/scripts/historical-profiles-seed.ts` that exports
`HISTORICAL_PROFILES_SEED: Array<InsertHistoricalProfile>` and is consumed by
the seed script we will write next.

## Editorial guidelines

- 6-12 word headlines, plain declarative voice, no exclamations
- ~280-400 word `body` field in clean Markdown (use `## Sub-head` for two or
  three internal sections). No italics. No emojis.
- Cite at least 2 sources via `sourceUrls`. Prefer:
  - Montana Historical Society (mhs.mt.gov)
  - Library of Congress, National Archives
  - University of Montana archives, MSU archives
  - Wikipedia as a tertiary anchor only if first-party sources lack a usable URL
  - The Missoulian / Billings Gazette archives only when they have a free article URL
- Anniversary date MUST be confirmed against at least two sources. If a
  birth or death date is disputed, prefer the date in the Montana Historical
  Society record and note "born around" only in the body, never in the
  headline.
- City selection: pick the primary Montana city most associated with the
  subject. Statewide figures (Plenty Coups, Jeannette Rankin) can use NULL
  city_id; everyone else gets a city.
- `kind`: 'figure' for people, 'event' for one-time happenings (Big Burn,
  Hellgate Treaty), 'place' rarely (founding day of a landmark, e.g. Going-to-
  the-Sun Road opening).
- `anniversaryKind`: 'birth' | 'death' | 'event' | 'other'. Default to 'birth'
  when both birth and death dates are known and the birth is more notable;
  use 'death' for figures most associated with the day they died (e.g.
  Plenty Coups). Use 'event' for non-person rows.

## City id mapping
1=missoula, 2=billings, 3=greatfalls, 4=bozeman, 5=butte, 6=helena,
7=kalispell, 8=havre, 9=whitefish, 10=laurel. NULL = statewide.

## Target subjects (must include all; add others to reach 35-40 total)

### Statewide / multi-city
- Charles M. Russell — cowboy artist, b. Mar 19 1864, d. Oct 24 1926. Great
  Falls primary.
- Plenty Coups — Crow chief, d. Mar 4 1932. NULL (statewide) — buried at
  Pryor near Billings but a statewide figure.
- Jeannette Rankin — first woman in U.S. Congress, b. Jun 11 1880, d. May 18
  1973. Missoula.
- A.B. Guthrie Jr. — Pulitzer novelist (The Way West), b. Jan 13 1901, d.
  Apr 26 1991. Choteau region; pick statewide.
- Norman Maclean — A River Runs Through It, Young Men and Fire, b. Dec 23
  1902, d. Aug 2 1990. Missoula.
- Mike Mansfield — longest-serving Senate majority leader, b. Mar 16 1903,
  d. Oct 5 2001. Butte (raised) but Missoula (UM tie).
- Mary MacLane — Butte memoirist, b. May 2 1881, d. Aug 7 1929. Butte.
- Evel Knievel — daredevil, b. Oct 17 1938, d. Nov 30 2007. Butte.

### Missoula
- Higgins / Worden founders. Christopher Higgins b. ~1830, d. Apr 14 1889.
- Norman Maclean (above).
- Mansfield (cross-listed).

### Billings
- Frederick Billings — namesake of the city, b. Sep 27 1823, d. Sep 30 1890.
- Plenty Coups (cross-listed, but he's NULL city)
- Yellowstone Kelly (Luther Kelly) — scout, b. Jul 27 1849, d. Dec 17 1928.

### Great Falls
- Paris Gibson — city founder, b. Jul 1 1830, d. Dec 16 1920.
- Charles M. Russell (primary city).

### Bozeman
- John Bozeman — trailblazer, b. Jan 1830, d. Apr 20 1867 (date of murder).
- Nelson Story — cattle drive pioneer, b. Apr 4 1838, d. Mar 10 1926.

### Butte
- Marcus Daly — Anaconda copper king, b. Dec 5 1841, d. Nov 12 1900.
- William A. Clark — copper king + senator, b. Jan 8 1839, d. Mar 2 1925.
- F. Augustus Heinze — third copper king, b. Dec 5 1869, d. Nov 4 1914.
- Frank Little — IWW organizer murdered in Butte, d. Aug 1 1917.
- Evel Knievel (cross-listed).
- Mary MacLane (cross-listed).

### Helena
- Thomas Francis Meagher — territorial gov, d. Jul 1 1867 (drowned in
  Missouri River).
- Wilbur Sanders — vigilante leader and senator, b. May 2 1834, d. Jul 7
  1905.

### Kalispell
- Charles Conrad — founder of Kalispell, b. Nov 20 1850, d. Nov 27 1902.

### Havre
- Long George Francis — outlaw / rancher, d. Dec 31 1920. (If sources thin,
  swap for Buckskin Charlie or skip.)
- Bear Paw battlefield (event) — Sep 30-Oct 5 1877 surrender of Chief Joseph.

### Whitefish
- Glacier National Park — established May 11 1910. (event, city=Whitefish or
  NULL.)

### Laurel
- Laurel's founding around 1882. If a clear founder can't be cited, swap
  for a regional event.

## Required events (kind='event')
- Hellgate Treaty signing, Jul 16 1855 (Missoula).
- The Big Burn, Aug 20-21 1910 (NULL).
- Custer's Last Stand, Jun 25 1876 (NULL or Billings — Little Bighorn is
  Crow Agency, closest is Billings).
- Glacier National Park established May 11 1910 (Whitefish or NULL).
- Montana statehood, Nov 8 1889 (NULL).
- Mann Gulch fire, Aug 5 1949 (Helena).
- Hebgen Lake earthquake, Aug 17 1959 (Bozeman area).

## Output format (TypeScript)

```ts
import type { InsertHistoricalProfile } from "../shared/schema.js";

export const HISTORICAL_PROFILES_SEED: InsertHistoricalProfile[] = [
  {
    subjectName: "Charles M. Russell",
    headline: "Cowboy artist Charlie Russell, born in 1864, defined Montana",
    body: "## ...\n\nBody text in Markdown.\n\n## Section\n\nMore.",
    kind: "figure",
    cityId: 3,
    anniversaryMonth: 3,
    anniversaryDay: 19,
    anniversaryYear: 1864,
    anniversaryKind: "birth",
    sourceUrls: [
      "https://en.wikipedia.org/wiki/Charles_Marion_Russell",
      "https://mhs.mt.gov/Shop/CharlesMRussell",
    ],
    imageUrl: null,
    imageCredit: null,
    tags: "art,charles-russell,great-falls",
    eligibleForFallback: true,
  },
  // ... 34+ more
];
```

Do not include `id`, `createdAt`, or `lastSurfacedAt` fields.

Image URLs: leave null for now. We can backfill from Wikimedia Commons in a
later pass — never invent image URLs.

## Verification

After writing the file, run `tsc --noEmit` on it to confirm types compile.
