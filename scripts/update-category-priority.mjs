/**
 * One-shot script: sets categoryPriority on all existing sources based on the docx.
 * Run: node scripts/update-category-priority.mjs
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../data.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Mapping from docx categories to our desks (drop geo-only: Local, Montana, National, Global)
function mapCategories(cats) {
  const MAP = {
    "crime": "crime",
    "sports": "sports",
    "business": "business",
    "events": "events",
    "health": "health",
    "people": "people",
    "historical": "history",
    "history": "history",
    "science & tech": "science_tech",
    "science_tech": "science_tech",
    "tech": "science_tech",
  };
  const result = [];
  const seen = new Set();
  for (const c of cats) {
    const mapped = MAP[c.toLowerCase().trim()];
    if (mapped && !seen.has(mapped)) {
      result.push(mapped);
      seen.add(mapped);
    }
  }
  return result;
}

// Source data from docx (name → ordered categories)
const SOURCE_CATEGORIES = [
  // Official Government
  { name: "City of Missoula", cats: ["Local", "Montana", "Business", "Events", "Crime", "Health", "Historical"] },
  { name: "Missoula County", cats: ["Local", "Montana", "Business", "Events", "Crime", "Health", "Historical"] },
  { name: "Missoula County Elections", cats: ["Local", "Montana", "National", "Historical"] },
  { name: "Missoula County Sheriff", cats: ["Crime", "Local", "Montana", "Events", "Historical"] },
  { name: "Missoula Police Department", cats: ["Crime", "Local", "Montana", "Events", "Historical"] },
  { name: "Missoula Public Library", cats: ["Local", "Events", "Historical", "People", "Science & Tech", "Health"] },
  { name: "Montana Secretary of State", cats: ["Montana", "National", "Business", "Historical"] },
  // Local News
  { name: "KPAX", cats: ["Local", "Montana", "Crime", "Sports", "Business", "Events", "Health", "National", "Historical"] },
  { name: "Missoula Current", cats: ["Local", "Montana", "Business", "Crime", "Events", "People", "Sports", "Health", "National", "Historical"] },
  { name: "Missoulian", cats: ["Local", "Montana", "Crime", "Sports", "Business", "Events", "People", "Health", "National", "Historical"] },
  { name: "Montana Free Press", cats: ["Montana", "Business", "National", "Crime", "Historical"] },
  { name: "Missoula Independent", cats: ["Local", "Montana", "People", "Events", "Business", "Historical"] },
  { name: "Billings Gazette", cats: ["Montana", "Local", "Crime", "Sports", "Business", "Events", "Historical"] },
  { name: "Flathead Beacon", cats: ["Montana", "Local", "Crime", "Sports", "Business", "Events", "Historical"] },
  { name: "Montana Standard", cats: ["Montana", "Local", "Crime", "Sports", "Business", "Events", "Historical"] },
  { name: "Montana Public Radio", cats: ["Montana", "Local", "National", "Global", "Business", "Events", "People", "Historical"] },
  { name: "Daily Montanan", cats: ["Montana", "Business", "National", "Crime", "Historical"] },
  { name: "Bozeman Daily Chronicle", cats: ["Montana", "Local", "Crime", "Sports", "Business", "Events", "People", "Historical"] },
  { name: "NBC Montana", cats: ["Montana", "Local", "National", "Crime", "Sports", "Business", "Events", "Global", "Historical"] },
  // People
  { name: "Keila Szpaller", cats: ["People", "Local", "Montana", "Business", "National", "Historical"] },
  { name: "Steve Daines", cats: ["People", "Montana", "National", "Business", "Historical"] },
  { name: "Steve Daines (U.S. Senator)", cats: ["People", "Montana", "National", "Business", "Historical"] },
  // Events
  { name: "Logjam Presents", cats: ["Events", "Local", "People", "Business", "Montana"] },
  { name: "Missoula Events", cats: ["Events", "Local", "People", "Business"] },
  { name: "Destination Missoula", cats: ["Events", "Local", "Business", "People", "Montana", "Global"] },
  { name: "GatherBoard", cats: ["Events", "Local", "Business", "People"] },
  { name: "Ticketmaster", cats: ["Events", "Local", "Montana", "People", "Business", "Global"] },
  { name: "Ticketmaster Missoula", cats: ["Events", "Local", "Montana", "People", "Business", "Global"] },
  { name: "Eventbrite", cats: ["Events", "Local", "Montana", "People", "Business", "Global"] },
  { name: "Eventbrite Missoula", cats: ["Events", "Local", "Montana", "People", "Business", "Global"] },
  { name: "Adams Center Events", cats: ["Events", "Local", "Sports", "People", "Business"] },
  { name: "Adams Center", cats: ["Events", "Local", "Sports", "People", "Business"] },
  { name: "Missoula County Fairgrounds", cats: ["Events", "Local", "People", "Historical"] },
  // Other Orgs
  { name: "Missoula Area Chamber of Commerce", cats: ["Business", "Local", "Events", "People", "Montana"] },
  { name: "Zootown Arts Community Center", cats: ["Events", "Local", "People", "Historical", "Business"] },
  { name: "Missoula Downtown Partnership", cats: ["Business", "Local", "Events", "People", "Historical"] },
  { name: "Missoula Downtown Association", cats: ["Business", "Local", "Events", "People"] },
  { name: "Missoula Food Bank", cats: ["Health", "Local", "Business", "Events", "People"] },
  { name: "United Way of Missoula County", cats: ["Health", "Local", "Business", "Events", "People"] },
  { name: "YMCA Missoula", cats: ["Health", "Local", "Sports", "Events", "People"] },
  { name: "University of Montana", cats: ["Science & Tech", "Local", "Montana", "Events", "People", "Sports", "Historical", "Global"] },
  { name: "Montana Grizzlies", cats: ["Sports", "Local", "Montana", "Events", "People"] },
  { name: "Montana Grizzlies (UM Athletics)", cats: ["Sports", "Local", "Montana", "Events", "People"] },
  { name: "Montana Griz Football", cats: ["Sports", "Local", "Montana", "Events", "People"] },
  { name: "Montana Griz Basketball", cats: ["Sports", "Local", "Montana", "Events", "People"] },
  { name: "National Weather Service Missoula", cats: ["Science & Tech", "Local", "Montana", "National", "Events", "Global"] },
];

// Get all sources from DB
const sources = sqlite.prepare("SELECT id, name, url FROM sources").all();
console.log(`[update-cat-priority] Found ${sources.length} sources in DB`);

const unmatched = [];

for (const docxSource of SOURCE_CATEGORIES) {
  const priority = mapCategories(docxSource.cats);
  if (priority.length === 0) continue;

  // Try to match by name (fuzzy: lowercase, partial)
  const docxNameLower = docxSource.name.toLowerCase();
  const match = sources.find((s) => {
    const nameLower = s.name.toLowerCase();
    return (
      nameLower === docxNameLower ||
      nameLower.includes(docxNameLower) ||
      docxNameLower.includes(nameLower)
    );
  });

  if (match) {
    sqlite
      .prepare("UPDATE sources SET category_priority = ? WHERE id = ?")
      .run(JSON.stringify(priority), match.id);
    console.log(`  ✓ Updated: ${match.name} → [${priority.join(", ")}]`);
  } else {
    unmatched.push(docxSource.name);
  }
}

if (unmatched.length > 0) {
  console.log("\n[update-cat-priority] UNMATCHED (not in DB — user can add via admin):");
  for (const n of unmatched) console.log(`  - ${n}`);
}

sqlite.close();
console.log("\n[update-cat-priority] Done.");
