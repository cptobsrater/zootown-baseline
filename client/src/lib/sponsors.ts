/**
 * Sponsor (banner ad) registry.
 *
 * Sponsors moved from a static file into the `sponsors` Postgres table on
 * 2026-06-12 to support in-place editing from the live site. This module
 * preserves the SAME public function names that the feed code consumes
 * (sponsorsForCity, shouldShowSponsorAfter, pickSponsorForSlot,
 * bannerSlotForIndex) so consumers don't need to change.
 *
 * Three rules still govern placement in any feed:
 *
 *   1. The first sponsor banner attaches to the BOTTOM of the 2nd post
 *      (zero-indexed: position 1).
 *   2. After that, a banner appears under every 3rd post (positions 4, 7,
 *      10, 13, ...).
 *   3. Banners ROTATE through sponsors eligible for the active city, ordered
 *      by sort_order on the sponsor_cities row, then round-robin.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

export interface Sponsor {
  /** Stable slug; used as React key and event tag. */
  id: string;
  /** Display name shown in the banner. */
  name: string;
  /** Logo path under /sponsors/. Loaded from /client/public/sponsors/. */
  logo: string;
  /** Logo alt text for screen readers. */
  logoAlt: string;
  /** Address line shown next to the logo. */
  address: string;
  /** Phone number, tel: link target. */
  phone: string;
  /** Optional tagline (e.g. "No Appointment Necessary"). */
  tagline?: string;
  /** Destination URL for the banner click. */
  href: string;
  /** Optional social links rendered as small icons on the right. */
  instagram?: string;
  facebook?: string;
}

/** Wire shape returned by /api/sponsors?city=<slug>. */
interface ApiSponsor {
  id: string;
  name: string;
  logoUrl: string;
  logoAlt: string;
  address: string;
  phone: string;
  tagline: string | null;
  href: string;
  instagram: string | null;
  facebook: string | null;
  isActive: boolean;
  cities: { citySlug: string; sortOrder: number }[];
}

function fromApi(s: ApiSponsor): Sponsor {
  return {
    id: s.id,
    name: s.name,
    logo: s.logoUrl,
    logoAlt: s.logoAlt,
    address: s.address,
    phone: s.phone,
    tagline: s.tagline ?? undefined,
    href: s.href,
    instagram: s.instagram ?? undefined,
    facebook: s.facebook ?? undefined,
  };
}

/**
 * Synchronous cache keyed by citySlug. Populated by useCitySponsors() the
 * first time a feed renders for that city. The legacy sponsorsForCity() and
 * pickSponsorForSlot() consumers read from this cache.
 *
 * Why synchronous? The feed code already lives inside React render; making
 * sponsorsForCity() async would force every consumer to handle a loading
 * state for what is fundamentally chrome data. Pre-warming via the hook +
 * reading from a Map keeps the call sites unchanged.
 */
const cache = new Map<string, Sponsor[]>();

/**
 * React hook that fetches sponsors for a city and warms the synchronous
 * cache. Call this once near the top of any page that renders the feed
 * (Home, calendar, etc.). The fetch is deduped/cached by react-query so
 * mounting the hook in multiple components is cheap.
 */
export function useCitySponsors(citySlug: string) {
  const q = useQuery<Sponsor[]>({
    queryKey: ["/api/sponsors", citySlug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sponsors?city=${encodeURIComponent(citySlug)}`);
      const data = (await res.json()) as { items: ApiSponsor[] };
      const mapped = data.items.map(fromApi);
      cache.set(citySlug, mapped);
      return mapped;
    },
    staleTime: 5 * 60 * 1000,
  });
  return q;
}

/**
 * Return the sponsors eligible for a given city slug, in declaration order.
 * Reads from the synchronous cache that useCitySponsors() warms. Returns
 * [] if the hook hasn't resolved yet -- in that case no banners are
 * inserted, which is the safe default.
 */
export function sponsorsForCity(citySlug: string): Sponsor[] {
  return cache.get(citySlug) ?? [];
}

/**
 * Given the index of a feed item (zero-based), return true when a sponsor
 * banner should attach to the BOTTOM of that post.
 *
 * Rule: the 2nd post (index 1) gets the first banner, then every 3rd post
 * thereafter (4, 7, 10, ...). Expressed in one line: 1, then 1 + 3k.
 */
export function shouldShowSponsorAfter(index: number): boolean {
  if (index < 1) return false;
  return index === 1 || (index - 1) % 3 === 0;
}

/**
 * Resolve which sponsor occupies the slot for a given (city, index) pair.
 * Uses round-robin over the eligible sponsors for that city.
 *
 *   Banner 1 (after post 2)  -> sponsors[0]
 *   Banner 2 (after post 5)  -> sponsors[1]
 *   Banner 3 (after post 8)  -> sponsors[2 % eligible.length]
 *
 * Returns null when there are no eligible sponsors for the city (either no
 * rows yet, or the hook hasn't loaded).
 */
export function pickSponsorForSlot(citySlug: string, slotIndex: number): Sponsor | null {
  const eligible = sponsorsForCity(citySlug);
  if (eligible.length === 0) return null;
  return eligible[slotIndex % eligible.length];
}

/**
 * Helper: convert a feed-item index into a 0-based banner slot index.
 *
 *   index=1  -> slot 0
 *   index=4  -> slot 1
 *   index=7  -> slot 2
 */
export function bannerSlotForIndex(index: number): number {
  return Math.max(0, Math.floor((index - 1) / 3));
}
