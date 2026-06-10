/**
 * Insert ticket-aggregator + fair/fairground sources for each city.
 *
 * Ticketmaster and Bandsintown publish per-city event-discovery pages that
 * embed JSON-LD Event blocks; our jsonLdEventParser picks them up.
 * Songkick + Eventbrite city pages do too. We also include local fairgrounds.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

// Load .env.local manually
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const CITY_ID = {
  missoula: 1, billings: 2, greatfalls: 3, bozeman: 4, butte: 5,
  helena: 6, kalispell: 7, havre: 8, whitefish: 9, laurel: 10,
};

// For Ticketmaster Discovery API would be cleaner, but we can use their
// /discover/concerts/...-tickets pages which include JSON-LD Event blocks.
// Bandsintown city pages also use schema.org Event markup.
// We use both for redundancy.
const SOURCES = [
  // -------- Missoula --------
  { slug: 'missoula', name: 'Ticketmaster — Missoula', url: 'https://www.ticketmaster.com/discover/concerts/missoula-mt' },
  { slug: 'missoula', name: 'Bandsintown — Missoula', url: 'https://www.bandsintown.com/c/missoula-mt' },
  { slug: 'missoula', name: 'Missoula County Fairgrounds — Events', url: 'https://www.missoulacountyfairgrounds.com/events' },

  // -------- Billings --------
  { slug: 'billings', name: 'Ticketmaster — Billings', url: 'https://www.ticketmaster.com/discover/concerts/billings-mt' },
  { slug: 'billings', name: 'Bandsintown — Billings', url: 'https://www.bandsintown.com/c/billings-mt' },
  { slug: 'billings', name: 'MetraPark — Calendar', url: 'https://www.metrapark.com/events' },

  // -------- Great Falls --------
  { slug: 'greatfalls', name: 'Ticketmaster — Great Falls', url: 'https://www.ticketmaster.com/discover/concerts/great-falls-mt' },
  { slug: 'greatfalls', name: 'Bandsintown — Great Falls', url: 'https://www.bandsintown.com/c/great-falls-mt' },
  { slug: 'greatfalls', name: 'Montana ExpoPark / State Fair', url: 'https://www.montanaexpopark.com/p/events' },
  { slug: 'greatfalls', name: 'Mansfield Center — Events', url: 'https://www.greatfallsmt.net/civicenter/mansfieldevents' },

  // -------- Bozeman --------
  { slug: 'bozeman', name: 'Ticketmaster — Bozeman', url: 'https://www.ticketmaster.com/discover/concerts/bozeman-mt' },
  { slug: 'bozeman', name: 'Bandsintown — Bozeman', url: 'https://www.bandsintown.com/c/bozeman-mt' },
  { slug: 'bozeman', name: 'Gallatin County Fairgrounds', url: 'https://www.gallatincomt.virtualtownhall.net/gallatin-county-fairgrounds' },

  // -------- Butte --------
  { slug: 'butte', name: 'Ticketmaster — Butte', url: 'https://www.ticketmaster.com/discover/concerts/butte-mt' },
  { slug: 'butte', name: 'Bandsintown — Butte', url: 'https://www.bandsintown.com/c/butte-mt' },

  // -------- Helena --------
  { slug: 'helena', name: 'Ticketmaster — Helena', url: 'https://www.ticketmaster.com/discover/concerts/helena-mt' },
  { slug: 'helena', name: 'Bandsintown — Helena', url: 'https://www.bandsintown.com/c/helena-mt' },
  { slug: 'helena', name: 'Lewis & Clark County Fair', url: 'https://www.lccountymt.gov/fair.html' },

  // -------- Kalispell --------
  { slug: 'kalispell', name: 'Ticketmaster — Kalispell', url: 'https://www.ticketmaster.com/discover/concerts/kalispell-mt' },
  { slug: 'kalispell', name: 'Bandsintown — Kalispell', url: 'https://www.bandsintown.com/c/kalispell-mt' },
  { slug: 'kalispell', name: 'Northwest Montana Fair', url: 'https://www.nwmtfair.com/events' },

  // -------- Havre --------
  { slug: 'havre', name: 'Ticketmaster — Havre', url: 'https://www.ticketmaster.com/discover/concerts/havre-mt' },
  { slug: 'havre', name: 'Bandsintown — Havre', url: 'https://www.bandsintown.com/c/havre-mt' },
  { slug: 'havre', name: 'Great Northern Fair (Hill County)', url: 'https://www.greatnorthernfair.com/' },

  // -------- Whitefish --------
  { slug: 'whitefish', name: 'Ticketmaster — Whitefish', url: 'https://www.ticketmaster.com/discover/concerts/whitefish-mt' },
  { slug: 'whitefish', name: 'Bandsintown — Whitefish', url: 'https://www.bandsintown.com/c/whitefish-mt' },

  // -------- Laurel --------
  { slug: 'laurel', name: 'Ticketmaster — Laurel', url: 'https://www.ticketmaster.com/discover/concerts/laurel-mt' },
  { slug: 'laurel', name: 'Bandsintown — Laurel', url: 'https://www.bandsintown.com/c/laurel-mt' },
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const existing = await client.query('SELECT lower(url) AS url FROM sources');
const seen = new Set(existing.rows.map(r => r.url));

let inserted = 0;
let skipped = 0;
for (const s of SOURCES) {
  if (seen.has(s.url.toLowerCase())) { skipped++; continue; }
  await client.query(
    `INSERT INTO sources (name, url, feed_url, feed_type, parser_key, source_type,
       desks, cadence_minutes, last_checked_at, last_status, last_mode, last_error,
       last_items, active, category, handle, platform, trust_score, city_id)
     VALUES ($1,$2,NULL,'html',NULL,'Community Calendar',$3,60,NULL,'idle',NULL,NULL,
             0,TRUE,'calendars',NULL,NULL,50,$4)`,
    [s.name, s.url, JSON.stringify(['entertainment']), CITY_ID[s.slug]],
  );
  inserted++;
}

console.log(`Inserted: ${inserted} · Skipped (dupes): ${skipped}`);

const counts = await client.query(
  "SELECT c.slug, COUNT(*) FROM sources s JOIN cities c ON c.id=s.city_id WHERE s.category='calendars' GROUP BY c.slug ORDER BY c.slug"
);
console.log('\nCalendar sources per city:');
for (const r of counts.rows) console.log(`  ${r.slug.padEnd(12)}: ${r.count}`);
await client.end();
