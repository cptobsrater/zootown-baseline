// One-off backfill: drain people-bank + history-bank into Supabase.
// Bypasses the daily 24h gate so we can seed the pool fast.
// Resets DAILY_WRITE_META_KEY to a recent time so the cron writer keeps alternating
// from the right spot after we're done.
import postgres from "postgres";
import { PEOPLE_BANK } from "../server/people-bank.ts";
import { HISTORY_BANK } from "../server/history-bank.ts";

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", prepare: false });

async function existingHeadlines(desk) {
  const rows = await sql`SELECT headline FROM history_stories WHERE desk = ${desk}`;
  return new Set(rows.map((r) => r.headline.toLowerCase().trim()));
}

async function insertArticle(desk, article, idx) {
  const now = new Date(Date.now() - idx * 60_000).toISOString(); // stagger by 1 minute so order is preserved
  await sql`
    INSERT INTO history_stories
      (headline, summary, source_url, desk, kind, published_at, last_bumped_at, is_visible, last_shown_at)
    VALUES
      (${article.headline}, ${article.body}, ${article.sourceUrl ?? null}, ${desk}, ${article.kind}, ${now}, ${now}, true, null)
  `;
}

let totalInserted = 0;
let lastDesk = "history";
let interleave = 0;
const desks = ["people", "history"]; // alternate
const banks = { people: PEOPLE_BANK, history: HISTORY_BANK };
const used = {
  people: await existingHeadlines("people"),
  history: await existingHeadlines("history"),
};
console.log(`Starting pool: people=${used.people.size}, history=${used.history.size}`);

while (true) {
  const desk = desks[interleave % 2];
  const bank = banks[desk];
  const next = bank.find((a) => !used[desk].has(a.headline.toLowerCase().trim()));
  if (!next) {
    // Try the other desk
    const other = desks[(interleave + 1) % 2];
    const otherNext = banks[other].find((a) => !used[other].has(a.headline.toLowerCase().trim()));
    if (!otherNext) break; // both desks exhausted
    interleave++;
    continue;
  }
  await insertArticle(desk, next, totalInserted);
  used[desk].add(next.headline.toLowerCase().trim());
  totalInserted++;
  lastDesk = desk;
  console.log(`  +${desk}: ${next.headline}`);
  interleave++;
}

// Reset the daily-write meta so the cron writes the *next* article tomorrow.
await sql`
  INSERT INTO meta (key, value) VALUES ('history_last_daily_write', ${new Date().toISOString()})
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
`;
await sql`
  INSERT INTO meta (key, value) VALUES ('history_last_daily_desk', ${lastDesk})
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
`;

// Final count
const [{ count: peopleCount }] = await sql`SELECT COUNT(*)::int AS count FROM history_stories WHERE desk='people'`;
const [{ count: historyCount }] = await sql`SELECT COUNT(*)::int AS count FROM history_stories WHERE desk='history'`;
console.log(`\nDone. Inserted ${totalInserted} articles total.`);
console.log(`Final pool: people=${peopleCount}, history=${historyCount}`);
console.log(`Cron will resume tomorrow with desk=${lastDesk === "history" ? "people" : "history"}`);

await sql.end();
