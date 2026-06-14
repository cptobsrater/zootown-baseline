/**
 * Curated Montana venue registry (Phase 14).
 *
 * Each venue declares up to two sources:
 *   - websiteSource: the venue's own site (preferred -- "we want to link to
 *     the venue's website, not Facebook" per the standing instruction).
 *   - facebookSource: their FB events tab (secondary cross-reference;
 *     optional but used as a fallback list URL for facebook_text venues).
 *
 * websiteSource.kind decides the collector:
 *   - "rss_then_jsonld": pull an RSS feed, then fetch each detail page and
 *     parse its schema.org Event JSON-LD. The strongest signal -- exact
 *     start times and ticket URLs straight out of `offers`.
 *   - "html_jsonld_list": fetch the events listing HTML, extract every
 *     /event/ detail-page link, then JSON-LD parse each (no RSS).
 *   - "facebook_text": render /<slug>/events via Cloudflare Browser
 *     Rendering and parse the visible-text event grid.
 *
 * Adding a new venue: prefer kind=rss_then_jsonld whenever the site
 * exposes /events/feed/ (Tribe's "The Events Calendar" plugin) and the
 * detail pages have <script type="application/ld+json"> Event blocks.
 * Confirm both with a curl + JSON-LD parse before adding the entry.
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
  "frontgatetickets.com",
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
  id: string;             // stable internal id
  name: string;           // display name
  cityId: number;         // matches cities.id
  citySlug: string;       // for display
  defaultDesk: "entertainment" | "city" | "sports" | "business" | "crime" | "health";
  websiteSource?: VenueWebsiteSource;
  facebookSource?: VenueFacebookSource;
}

// City IDs (from cities table):
//   1 missoula, 2 billings, 3 greatfalls, 4 bozeman, 5 butte,
//   6 helena, 7 kalispell, 8 havre, 9 whitefish, 10 laurel
export const CURATED_VENUES: CuratedVenue[] = [
  // =====================================================================
  // Tier 1: RSS + JSON-LD (best -- real ticket URLs, no Cloudflare needed)
  // =====================================================================
  {
    id: "newberry",
    name: "The Newberry",
    cityId: 3,
    citySlug: "greatfalls",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "rss_then_jsonld",
      homeUrl: "https://thenewberrymt.com/",
      listUrl: "https://thenewberrymt.com/events/feed/",
      detailLinkContains: "/event/",
    },
    facebookSource: { slug: "thenewberrymt" },
  },
  {
    id: "flathead-library",
    name: "ImagineIF / Flathead County Library",
    cityId: 7,
    citySlug: "kalispell",
    defaultDesk: "city",
    websiteSource: {
      kind: "rss_then_jsonld",
      homeUrl: "https://flatheadcountylibrary.org/",
      // Tribe "The Events Calendar" lives at /events-calendar/ here.
      listUrl: "https://flatheadcountylibrary.org/events-calendar/feed/",
      detailLinkContains: "/event/",
    },
  },
  {
    id: "gf-library",
    name: "Great Falls Public Library",
    cityId: 3,
    citySlug: "greatfalls",
    defaultDesk: "city",
    websiteSource: {
      kind: "rss_then_jsonld",
      homeUrl: "https://greatfallslibrary.org/",
      listUrl: "https://greatfallslibrary.org/events/feed/",
      detailLinkContains: "/event/",
    },
    facebookSource: { slug: "greatfallspubliclibrary" },
  },

  // =====================================================================
  // Tier 2: Facebook-only (needs CF Browser Rendering env)
  // =====================================================================
  {
    id: "metrapark",
    name: "MetraPark",
    cityId: 2,
    citySlug: "billings",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.metrapark.com/",
      listUrl: "https://www.facebook.com/MetraPark/events",
    },
    facebookSource: { slug: "MetraPark" },
  },
  {
    id: "alberta-bair",
    name: "Alberta Bair Theater",
    cityId: 2,
    citySlug: "billings",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://albertabairtheater.org/",
      listUrl: "https://www.facebook.com/AlbertaBairTheater/events",
    },
    facebookSource: { slug: "AlbertaBairTheater" },
  },
  {
    id: "wilma",
    name: "The Wilma",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.logjampresents.com/the-wilma",
      listUrl: "https://www.facebook.com/thewilmamissoula/events",
    },
    facebookSource: { slug: "thewilmamissoula" },
  },
  {
    id: "logjam",
    name: "Logjam Presents",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "entertainment",
    websiteSource: {
      // Logjam promotes shows across Top Hat, KettleHouse, Wilma, and The
      // ELM. Their promoter FB page consolidates everything in one place.
      kind: "facebook_text",
      homeUrl: "https://www.logjampresents.com/",
      listUrl: "https://www.facebook.com/LogjamPresents/events",
    },
    facebookSource: { slug: "LogjamPresents" },
  },
  {
    id: "kettlehouse",
    name: "KettleHouse Amphitheater",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.logjampresents.com/kettlehouse-amphitheater",
      listUrl: "https://www.facebook.com/KettlehouseAmphitheater/events",
    },
    facebookSource: { slug: "KettlehouseAmphitheater" },
  },
  {
    id: "roxy",
    name: "Roxy Theater",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://theroxytheater.org/",
      listUrl: "https://www.facebook.com/TheRoxyTheater/events",
    },
    facebookSource: { slug: "TheRoxyTheater" },
  },
  {
    id: "zacc",
    name: "Zootown Arts Community Center",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://zootownarts.org/",
      listUrl: "https://www.facebook.com/thezacc/events",
    },
    facebookSource: { slug: "thezacc" },
  },
  {
    id: "missoula-library",
    name: "Missoula Public Library",
    cityId: 1,
    citySlug: "missoula",
    defaultDesk: "city",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://missoulapubliclibrary.org/",
      listUrl: "https://www.facebook.com/missoulapubliclibrary/events",
    },
    facebookSource: { slug: "missoulapubliclibrary" },
  },
  {
    id: "elm",
    name: "The ELM",
    cityId: 4,
    citySlug: "bozeman",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://logjampresents.com/the-elm",
      listUrl: "https://www.facebook.com/elmbozeman/events",
    },
    facebookSource: { slug: "elmbozeman" },
  },
  {
    id: "emerson",
    name: "Emerson Center for the Arts & Culture",
    cityId: 4,
    citySlug: "bozeman",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.theemerson.org/",
      listUrl: "https://www.facebook.com/TheEmersondotcom/events",
    },
    facebookSource: { slug: "TheEmersondotcom" },
  },
  {
    id: "myrna-loy",
    name: "The Myrna Loy",
    cityId: 6,
    citySlug: "helena",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://themyrnaloy.com/",
      listUrl: "https://www.facebook.com/themyrnaloy/events",
    },
    facebookSource: { slug: "themyrnaloy" },
  },
  {
    id: "whitefish-theatre",
    name: "Whitefish Theatre Co.",
    cityId: 9,
    citySlug: "whitefish",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://whitefishtheatreco.org/",
      listUrl: "https://www.facebook.com/whitefishtheatreco/events",
    },
    facebookSource: { slug: "whitefishtheatreco" },
  },
  {
    id: "fvcc",
    name: "Flathead Valley Community College",
    cityId: 7,
    citySlug: "kalispell",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.fvcc.edu/",
      listUrl: "https://www.facebook.com/fvccmt/events",
    },
    facebookSource: { slug: "fvccmt" },
  },
  {
    id: "mother-lode",
    name: "Mother Lode Theatre",
    cityId: 5,
    citySlug: "butte",
    defaultDesk: "entertainment",
    websiteSource: {
      kind: "facebook_text",
      homeUrl: "https://www.buttearts.org/",
      listUrl: "https://www.facebook.com/motherlodetheatre/events",
    },
    facebookSource: { slug: "motherlodetheatre" },
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
