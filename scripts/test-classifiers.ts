/**
 * Smoke test for Phase 15 classifiers + scorer. Hand-crafted headlines
 * representing each major case. No DB writes -- just prints the outputs
 * so we can verify behavior before backfilling production.
 */
import { classifySports } from "../server/learning/sports-classifier.js";
import { classifyPeople } from "../server/learning/people-classifier.js";
import { classifyObituary } from "../server/learning/obituary-classifier.js";
import { scoreStory } from "../server/learning/relevance-scorer.js";

interface Case {
  label: string;
  headline: string;
  summary?: string;
  publishedAt?: string;
  url?: string;
  sourceName?: string;
}

const now = new Date();
const oneHrAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const sixHrAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

const CASES: Case[] = [
  // Sports wins -- should celebrate
  {
    label: "Bobcats win (D-I)",
    headline: "Bobcats edge Idaho 24-21 in Big Sky thriller",
    summary: "Montana State held off a late charge to win at home.",
    publishedAt: oneHrAgo,
  },
  {
    label: "HS win, both teams MT",
    headline: "Billings West defeats Senior High 35-14",
    summary: "Golden Bears dominated in the second half.",
    publishedAt: oneHrAgo,
  },
  {
    label: "Mustangs win",
    headline: "Billings Mustangs rally past PaddleHeads 7-5",
    publishedAt: sixHrAgo,
  },

  // Sports losses -- post but don't elevate
  {
    label: "Griz loss (only MT team lost)",
    headline: "Grizzlies fall to Sacramento State 31-24",
    publishedAt: oneHrAgo,
  },

  // Sports preview -- not a recap
  {
    label: "Schedule announcement",
    headline: "Bobcats will host Idaho State this Saturday",
    publishedAt: oneHrAgo,
  },

  // People profiles
  {
    label: "National athlete signing",
    headline: "Marcus Yang of Bozeman commits to Cal",
    summary: "The senior receiver chose Berkeley over a half-dozen Pac-12 schools.",
    publishedAt: oneHrAgo,
  },
  {
    label: "Local award",
    headline: "Missoula attorney Sarah Lewis wins national pro bono award",
    summary: "Lewis was honored at the ABA conference in Chicago.",
    publishedAt: oneHrAgo,
  },
  {
    label: "Teacher of the Year",
    headline: "Helena teacher named Montana Teacher of the Year",
    summary: "Jane Doe of Capital High received the state honor on Tuesday.",
    publishedAt: oneHrAgo,
  },
  {
    label: "Chess kid",
    headline: "Bozeman senior takes 1st at national high school chess championship",
    publishedAt: oneHrAgo,
  },

  // Negative -- should NOT be People
  {
    label: "Negative event -- arrest",
    headline: "Local doctor arrested on fraud charges",
    publishedAt: oneHrAgo,
  },
  {
    label: "Negative event -- lawsuit",
    headline: "Missoula attorney Sarah Lewis sued by former client",
    publishedAt: oneHrAgo,
  },

  // Obituaries
  {
    label: "Obit -- name + age",
    headline: "Jane Marie Doe, 87",
    summary: "Jane Marie Doe, 87, of Bozeman, passed away peacefully at home on Tuesday.",
    publishedAt: oneHrAgo,
    url: "https://example.com/obituaries/jane-doe",
  },
  {
    label: "Obit -- year range",
    headline: "Robert J. Smith (1938 - 2026)",
    summary: "Robert J. Smith died Tuesday surrounded by family.",
    publishedAt: oneHrAgo,
  },

  // Regular news baseline
  {
    label: "Regular news",
    headline: "City council approves new sewer project",
    publishedAt: oneHrAgo,
  },
  {
    label: "Same news, 1 day old",
    headline: "City council approves new sewer project",
    publishedAt: oneDayAgo,
  },
];

for (const c of CASES) {
  const sports = classifySports({ headline: c.headline, summary: c.summary });
  const people = classifyPeople({ headline: c.headline, summary: c.summary });
  const obit = classifyObituary({
    headline: c.headline,
    summary: c.summary,
    sourceUrl: c.url,
    sourceName: c.sourceName,
  });
  const score = scoreStory({
    publishedAt: c.publishedAt ?? new Date().toISOString(),
    isSportsRecap: sports.isSportsRecap,
    hasLocalWin: sports.hasLocalWin,
    sportsLevel: sports.level,
    isPeopleProfile: people.isPeopleProfile,
    peopleScope: people.scope,
    isObituary: obit.isObituary,
  });
  console.log(`\n--- ${c.label} ---`);
  console.log(`  headline: ${c.headline}`);
  console.log(`  sports: recap=${sports.isSportsRecap} won=[${sports.teamsWon.join(",")}] lost=[${sports.teamsLost.join(",")}] level=${sports.level}`);
  console.log(`  people: profile=${people.isPeopleProfile} scope=${people.scope} subject=${people.subject} alsoSports=${people.alsoSports}`);
  console.log(`  obit: ${obit.isObituary}${obit.reason ? " (" + obit.reason + ")" : ""}`);
  console.log(`  score: ${score.score} (base=${score.base} decay=${score.decay.toFixed(2)} cat=${score.category})`);
}
