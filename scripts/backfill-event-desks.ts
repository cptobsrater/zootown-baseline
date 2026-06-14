/**
 * Re-classify all calendar events through the desk classifier.
 *
 * Pulls every row from `events`, runs classifyEvent() with skipGemini=false
 * (full quality), and updates the row if the desk changes. Idempotent; safe
 * to run repeatedly.
 *
 * Usage: tsx scripts/backfill-event-desks.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { events } from "../shared/schema.js";
import { classifyEvent, EVENT_DESKS } from "../server/learning/event-classifier.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = postgres(url, { prepare: false, max: 1, ssl: "require" });
  const db = drizzle(client);

  const rows = await db.select().from(events);
  console.log(`Found ${rows.length} events. Re-classifying...`);

  let unchanged = 0;
  let changed = 0;
  let mapped = 0; // retired-desk normalizations
  const changesByDesk = new Map<string, number>();

  for (const ev of rows) {
    const before = ev.desk ?? "";
    // First: collapse retired desks into the new allowed set so we always
    // start from a valid baseline before re-classifying.
    let baseline = before;
    if (before === "culture" || before === "events") baseline = "entertainment";
    if (before === "community" || before === "people" || before === "history") baseline = ""; // force re-classification
    if (!(EVENT_DESKS as readonly string[]).includes(baseline)) baseline = "";

    // Run the classifier (with Gemini fallback) using the title + venue
    // + source as signals. We only override when the classifier is
    // confident (rule hit) OR baseline is empty (retired desk).
    const result = await classifyEvent({
      headline: ev.title,
      summary: ev.description ?? "",
      venue: ev.venue,
      sourceName: ev.sourceName,
    });

    const newDesk = (() => {
      // If baseline is a valid current desk and classifier hit a rule
      // that DISAGREES, trust the rule (it's specific). Otherwise keep
      // baseline.
      if (!baseline) return result.desk;
      if (result.confidence === "rule" && result.desk !== baseline) return result.desk;
      return baseline;
    })();

    if (newDesk !== before) {
      await db.update(events).set({ desk: newDesk }).where(eq(events.id, ev.id));
      changed++;
      if (before === "culture" || before === "community" || before === "events" || before === "people" || before === "history") {
        mapped++;
      }
      const key = `${before || "(empty)"} -> ${newDesk}`;
      changesByDesk.set(key, (changesByDesk.get(key) ?? 0) + 1);
      console.log(`  #${ev.id} "${ev.title.slice(0, 60)}" : ${before || "(empty)"} -> ${newDesk} [${result.confidence}${result.rule ? `: ${result.rule}` : ""}]`);
    } else {
      unchanged++;
    }
  }

  console.log(`\nDone. unchanged=${unchanged} changed=${changed} retired_mapped=${mapped}`);
  console.log("Transitions:");
  for (const [k, v] of Array.from(changesByDesk.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
