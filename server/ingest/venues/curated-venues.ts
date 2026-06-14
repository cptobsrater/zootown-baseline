/**
 * Curated Montana venue registry (Phase 14).
 *
 * Each venue declares up to two sources:
 *   - websiteSource: the venue's own site (preferred -- "we want to link to
 *     the venue's website, not Facebook" per the standing instruction).
 *   - facebookSource: their FB events tab (secondary cross-reference; many
 *     venues have a sparsely-updated FB events tab so we treat it as
 *     optional).
 *
 * Each website source has a `kind` that picks which collector to use:
 *   - "rss_then_jsonld": pull an RSS feed of events, then fetch each
 *     event detail page and parse the JSON-LD Event block. The cleanest
 *     possible pipeline -- exact start times, ticket URLs straight out
 *     of the offers field.
 *   - "html_jsonld_list": fetch the events listing HTML, extract every
 *     /event/ detail-page link, then JSON-LD parse each. For sites
 *     that don't expose an RSS feed.
 *   - "facebook_text": Facebook /<slug>/events visible-text scrape
 *     (used by venues with no real website event listing; MetraPark is
 *     our only one of these in the pilot).
 *
 * Ticket platform hosts: any link landing on one of these is treated as
 * a "ticket" link type. Order matters only for documentation; we accept
 * any match.
 */
export const TICKET_HOSTS = [
  "etix.com",
  "seetickets.us",
  "axs.com",
  "ticketmaster.com",
  "ticketmaster.ca",
  "livenation.com",
  "eventbrite.com",
  "prekindle.com",
  "tixr.com",
  "showclix.com",
  "brownpapertickets.com",
  "stranger.tickets",
] as const;

export type WebsiteSourceKind = "rss_then_jsonld" | "html_jsonld_list" | "facebook_text";

export interface VenueWebsiteSource {
  kind: WebsiteSourceKind;
  /** Landing URL we always link readers to as a last-resort fallback. */
  homeUrl: string;
  /** Events listing page (HTML) or RSS feed URL. */
  listUrl: string;
  /** Detail-page URL substring used to identify event links on the listing. */
  detailLinkContains?: string;
}

export interface VenueFacebookSource {
  /** Facebook page slug -- e.g. "thenewberrymt" gives /thenewberrymt/events. */
  slug: string;
}

export interface CuratedVenue {
  id: string;             // stable internal id, e.g. "newberry"
  name: string;           // display name, e.g. "The Newberry"
  cityId: number;         // matches cities.id (great_falls=3, billings=2, etc.)
  citySlug: string;       // for the source_name display
  /** Default desk if the classifier doesn't rule-match (most venues = entertainment). */
  defaultDesk: "entertainment" | "city" | "sports" | "business" | "crime" | "health";
  websiteSource?: VenueWebsiteSource;
  facebookSource?: VenueFacebookSource;
}

// Pilot list. Expanding to the full statewide roster comes after we
// validate the loop with these two.
export const CURATED_VENUES: CuratedVenue[] = [
  {
    id: "newberry",
    name: "The Newberry",
    cityId: 3, // greatfalls
    citySlug: "greatfalls",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "rss_then_jsonld",
      homeUrl: "https://thenewberrymt.com/",
      // The site exposes a clean RSS feed at /events/feed/ with 24 upcoming
      // shows; each <item><link> goes to a detail page that embeds a
      // schema.org/Event JSON-LD block with the exact startDate and an
      // offers.url pointing at the Etix purchase page.
      listUrl: "https://thenewberrymt.com/events/feed/",
      detailLinkContains: "/event/",
    },
    facebookSource: {
      // The Newberry's FB events tab is essentially empty (events go on the
      // site, not FB) but we keep the slug so the link is on record and we
      // can probe again later in case they ever start using it.
      slug: "thenewberrymt",
    },
  },
  {
    id: "metrapark",
    name: "MetraPark",
    cityId: 2, // billings
    citySlug: "billings",
    defaultDesk: "entertainment",
    websiteSource: {
      // MetraPark's primary listing IS their Facebook events tab -- we
      // validated this in the recon probe (8 upcoming events with start
      // times, locations, organizers rendered in plain text).
      kind: "facebook_text",
      homeUrl: "https://www.metrapark.com/",
      listUrl: "https://www.facebook.com/MetraPark/events",
    },
    facebookSource: {
      slug: "MetraPark",
    },
  },
];

export function venueById(id: string): CuratedVenue | undefined {
  return CURATED_VENUES.find((v) => v.id === id);
}

/** Returns true when a URL's hostname matches one of our known ticketing platforms. */
export function isTicketHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, "");
    return TICKET_HOSTS.some((th) => host === th || host.endsWith(`.${th}`));
  } catch {
    return false;
  }
}
