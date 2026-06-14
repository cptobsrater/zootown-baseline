/**
 * Dry-run preview of the Phase 14 venue collectors. Runs each curated
 * venue's website collector + Facebook collector (when CF env is set)
 * and prints what would be inserted -- without touching the DB.
 *
 * Usage: tsx scripts/preview-venue-ingest.ts
 */
import "dotenv/config";
import { CURATED_VENUES, isTicketHost } from "../server/ingest/venues/curated-venues.js";
import { collectFromVenueWebsite } from "../server/ingest/venues/website-collector.js";
import { collectFromVenueFacebook } from "../server/ingest/venues/facebook-collector.js";

async function main() {
  for (const v of CURATED_VENUES) {
    console.log(`\n=== ${v.name} (${v.id}, city=${v.citySlug}) ===`);
    console.log(`Website source: ${v.websiteSource?.kind ?? "(none)"}  list=${v.websiteSource?.listUrl ?? "-"}`);
    const website = await collectFromVenueWebsite(v);
    console.log(`  website -> ${website.length} events`);
    for (const e of website.slice(0, 10)) {
      const ticket = e.ticketUrl ? (isTicketHost(e.ticketUrl) ? `TICKET ${e.ticketUrl}` : `(non-ticket) ${e.ticketUrl}`) : "(no ticket)";
      console.log(`    - ${e.startsAt}  ${e.title.slice(0, 60).padEnd(60)}  ${ticket}`);
    }
    const fb = await collectFromVenueFacebook(v);
    console.log(`  facebook -> ${fb.events.length} events (fetchOk=${fb.fetchOk}${fb.reason ? " " + fb.reason : ""})`);
    for (const e of fb.events.slice(0, 10)) {
      console.log(`    - ${e.startsAt}  ${e.title.slice(0, 60).padEnd(60)}  raw="${e.rawTimeText}"`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
