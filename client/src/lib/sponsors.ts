/**
 * Sponsor (banner ad) registry.
 *
 * Three rules govern placement in any feed:
 *
 *   1. The first sponsor banner attaches to the BOTTOM of the 2nd post
 *      (zero-indexed: position 1).
 *   2. After that, a banner appears under every 3rd post (positions 4,
 *      7, 10, 13, ...). The math is: insertAfterIndex === 1 ||
 *      (insertAfterIndex - 1) % 3 === 0.
 *   3. Banners ROTATE through the sponsors eligible for the active city.
 *      Round-robin starting from index 0, so the same banner never
 *      appears twice in a row when a city has 2+ eligible sponsors.
 *
 * Per-city eligibility is declared statically below so the rotation is
 * deterministic and offline-safe; no DB call needed for what's currently
 * three sponsors. When the list grows large enough to need management,
 * we'll move this to a `sponsors` table + admin form.
 *
 * Visual style is set by the SponsorBanner component, not here -- this
 * file is pure data.
 */

import type { CitySlug } from "@shared/schema";

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
  /** Per-city eligibility list (slugs). Banner only shown in these cities. */
  cities: CitySlug[];
}

// Order matters: sponsors are rotated round-robin starting at index 0,
// so the FIRST sponsor eligible for a given city is the one that appears
// under the second post (the first banner slot). Smoke City is intentionally
// placed first so it leads the Missoula rotation as the newest sponsor.
export const SPONSORS: Sponsor[] = [
  {
    id: "smoke-city-missoula",
    name: "Smoke City Glass & Vape",
    logo: "/sponsors/smokecity.png",
    logoAlt: "Smoke City Glass & Vape logo",
    address: "2400 Brooks St · Missoula, MT 59801",
    phone: "(406) 304-3030",
    // Click target: the exact Google Maps URL the sponsor requested -- a
    // map view centered on the Brooks St shop with all Smoke City
    // locations visible. Recipient sees the storefront pin, hours,
    // photos, reviews, and a Directions button.
    href: "https://www.google.com/maps/search/Smoke+City/@46.8715711,-114.0120254,14z/data=!3m1!4b1?entry=ttu&g_ep=EgoyMDI2MDYwMy4xIKXMDSoASAFQAw%3D%3D",
    cities: ["missoula"],
  },
  {
    id: "wheat-missoula",
    name: "The Wheat Bakery & Deli — Missoula",
    logo: "/sponsors/wheat.png",
    logoAlt: "The Wheat Bakery & Deli logo",
    address: "2520 S 3rd St W · Missoula, MT",
    phone: "(406) 327-0900",
    href: "https://wheatmissoula.com",
    cities: ["missoula"],
  },
  {
    id: "docs-sandwich",
    name: "Doc's Sandwich Shop",
    logo: "/sponsors/docs.png",
    logoAlt: "Doc's Sandwich Shop logo",
    address: "214 N Higgins Ave · Missoula, MT 59802",
    phone: "(406) 542-7414",
    tagline: "No Appointment Necessary",
    href: "https://docsmt.com",
    // Doc's runs in BOTH Missoula and Great Falls feeds.
    cities: ["missoula", "greatfalls"],
  },
  {
    id: "wheat-greatfalls",
    name: "The Wheat Bakery & Deli — Great Falls",
    logo: "/sponsors/wheat.png",
    logoAlt: "The Wheat Bakery & Deli logo",
    address: "1116 9th St South · Great Falls, MT",
    phone: "(406) 771-7456",
    href: "https://wheatgreatfalls.com",
    cities: ["greatfalls"],
  },
];

/**
 * Return the sponsors eligible for a given city slug, in declaration order.
 * Empty array = no sponsors yet, so the feed should not insert any banners.
 */
export function sponsorsForCity(citySlug: string): Sponsor[] {
  return SPONSORS.filter((s) => s.cities.includes(citySlug as CitySlug));
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
 * Uses round-robin starting at the first eligible sponsor.
 *
 *   Banner 1 (after post 2)  -> sponsors[0]
 *   Banner 2 (after post 5)  -> sponsors[1]
 *   Banner 3 (after post 8)  -> sponsors[2 % eligible.length]
 *   ...
 *
 * Returns null when there are no eligible sponsors for the city.
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
 *
 * Pre-condition: shouldShowSponsorAfter(index) must return true.
 */
export function bannerSlotForIndex(index: number): number {
  // (index - 1) / 3 by construction (index = 1 + 3k).
  return Math.max(0, Math.floor((index - 1) / 3));
}
