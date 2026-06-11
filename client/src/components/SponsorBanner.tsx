import type { Sponsor } from "@/lib/sponsors";
import { Phone, ExternalLink, Instagram, Facebook } from "lucide-react";

interface Props {
  sponsor: Sponsor;
  /** Optional accent stripe color; defaults to the muted-foreground tone. */
  accent?: string;
}

/**
 * Banner ad shown under every third feed card (rule lives in lib/sponsors.ts).
 *
 * Design intent:
 *   - Small footprint (~64px tall on desktop, ~80 on mobile) so it never
 *     dominates the feed.
 *   - Type sizes blend with the rest of the app: small mono "SPONSOR"
 *     label mirrors the desk badges, address in 0.75rem body text.
 *   - Subtle border + tinted background so the banner is clearly an ad
 *     without shouting; left edge gets a soft amber-gold stripe.
 *   - Whole left-side (logo + name + address) is one clickable link to
 *     the sponsor's main destination. The right-side action buttons --
 *     phone, Instagram, Facebook -- are SIBLING links (not nested) so
 *     they have their own click targets and HTML stays valid.
 *   - Logo tile renders against white so dark and light brand logos
 *     both read against the cream-tinted theme.
 */
export function SponsorBanner({ sponsor }: Props) {
  const phoneHref = `tel:${sponsor.phone.replace(/[^\d+]/g, "")}`;
  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-border/40 bg-gradient-to-b from-amber-50/40 to-amber-50/10 dark:from-amber-950/15 dark:to-transparent">
      {/* Soft amber accent stripe along the left edge -- the universal
          "sponsored / paid" visual cue without invoking a desk color. */}
      <div className="absolute inset-y-0 left-0 w-1 bg-amber-500/60" />

      {/*
        Two-section layout to avoid nested <a> tags (which are invalid
        HTML and break click targeting on iOS Safari):

          - <a> on the LEFT covers the logo + name + address as the main
            click target (sponsor.href -- their website or Maps listing).
          - <div> on the RIGHT hosts the action icons. Each is its own
            sibling <a> so tapping it goes ONLY to that destination:
            dialing the phone, opening Instagram, or opening Facebook.
      */}
      <div className="flex items-center gap-3 py-2.5 pl-4 pr-3">
        <a
          href={sponsor.href}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors hover:bg-amber-50/30 dark:hover:bg-amber-950/20"
          data-testid={`sponsor-${sponsor.id}`}
          aria-label={`Sponsored by ${sponsor.name} - visit website`}
        >
          {/* Logo tile -- white background so brand colors read uniformly. */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-black/5">
            <img
              src={sponsor.logo}
              alt={sponsor.logoAlt}
              className="max-h-9 max-w-9 object-contain"
              loading="lazy"
            />
          </div>

          {/* Center: name + tagline + address. Two-line layout that
              collapses gracefully on narrow viewports. */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                Sponsor
              </span>
              <span className="truncate text-[0.82rem] font-semibold text-foreground">
                {sponsor.name}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.72rem] text-muted-foreground">
              {sponsor.tagline && (
                <span className="italic text-foreground/70">{sponsor.tagline}</span>
              )}
              <span className="truncate">{sponsor.address}</span>
            </div>
          </div>
        </a>

        {/* Right: phone + social icons + external indicator. SIBLING to
            the main <a> so the markup is valid. Each link points to its
            own destination and does NOT trigger the main banner click. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={phoneHref}
            className="hidden items-center gap-1 rounded-md border border-border/40 bg-background/60 px-2 py-1 text-[0.7rem] text-muted-foreground hover:text-foreground sm:inline-flex"
            aria-label={`Call ${sponsor.name} at ${sponsor.phone}`}
          >
            <Phone className="h-3 w-3" />
            {sponsor.phone}
          </a>
          {sponsor.instagram && (
            <a
              href={sponsor.instagram}
              target="_blank"
              rel="sponsored noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/60 text-muted-foreground hover:text-foreground"
              aria-label={`${sponsor.name} on Instagram`}
              title="Instagram"
            >
              <Instagram className="h-3.5 w-3.5" />
            </a>
          )}
          {sponsor.facebook && (
            <a
              href={sponsor.facebook}
              target="_blank"
              rel="sponsored noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/60 text-muted-foreground hover:text-foreground"
              aria-label={`${sponsor.name} on Facebook`}
              title="Facebook"
            >
              <Facebook className="h-3.5 w-3.5" />
            </a>
          )}
          <ExternalLink
            className="h-3.5 w-3.5 text-muted-foreground/70"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
