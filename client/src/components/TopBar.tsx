import { useState } from "react";
import { Wordmark } from "./Logo";
import { useTheme } from "@/lib/theme";
import { Search, Sun, Moon, Info, Calendar } from "lucide-react";
import { type DeskId, DESK_META } from "@/lib/format";
import { Link, useLocation } from "wouter";
import { CitySwitcher } from "./CitySwitcher";
import { useCity } from "@/lib/city-context";
import { MobileCalendarSheet } from "./MobileCalendarSheet";

interface Props {
  /** Set of currently-selected desks. Empty set == "All" (no filter). */
  desks: Set<DeskId>;
  /** Toggle a single desk. Pass null to clear all (i.e. select "All"). */
  onDeskToggle: (d: DeskId | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenSources: () => void;
  lastUpdatedLabel: string;
}

// Public-facing desk tabs. Order matters — 5 breaking-news desks, then
// People (community celebration), then History (looking back). Health was
// retired June 14 2026; its stories live on the legacy 'health' desk in the
// DB but no longer appear in the public nav or feeds.
const TABS: Array<{ id: "all" | DeskId; label: string }> = [
  { id: "all", label: "All" },
  { id: "city", label: "City" },
  { id: "business", label: "Business" },
  { id: "crime", label: "Crime" },
  { id: "sports", label: "Sports" },
  { id: "entertainment", label: "Entertainment" },
  { id: "people", label: "People" },
  { id: "history", label: "History" },
];

export function TopBar({
  desks,
  onDeskToggle,
  query,
  onQueryChange,
  onOpenSources,
  lastUpdatedLabel,
}: Props) {
  const { theme, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const { currentCity } = useCity();
  const [mobileCalOpen, setMobileCalOpen] = useState(false);
  // Home is now the city root: /missoula, /billings, etc.
  const onHome = /^\/[a-z_]+\/?$/i.test(location);

  // When user clicks a desk tab from a non-home page (Calendar, Jobs, Admin),
  // route them home and pre-select the desk via window-stashed signal so the
  // home page picks it up on mount. "All" clears the multi-selection.
  function handleDeskClick(id: "all" | DeskId) {
    if (onHome) {
      onDeskToggle(id === "all" ? null : id);
    } else {
      if (typeof window !== "undefined") {
        (window as any).__pendingDesk = id;
      }
      navigate(`/${currentCity.slug}`);
    }
  }

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-5 md:px-6 lg:py-3.5">
        {/* Left: logo + location (same row on mobile and desktop) */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Logo links to the landing page (city picker). Use the CitySwitcher
              pill or the desk tabs to navigate within a city. */}
          <Link href="/" data-testid="link-landing" aria-label="ZooTown home — pick a city" className="shrink-0">
            <Wordmark />
          </Link>
          <CitySwitcher />
        </div>

        {/* Right: search + actions */}
        <div className="flex items-center gap-2">
          <label className="relative flex-1 md:w-[320px] md:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={`Search ${currentCity.displayName}…`}
              aria-label="Search"
              data-testid="input-search"
              className="w-full rounded-md border border-input bg-background/80 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </label>
          {/* Mobile-only calendar icon — opens the full-screen calendar sheet.
              Desktop users still use the Calendar link in the desk-tab row. */}
          <button
            onClick={() => setMobileCalOpen(true)}
            data-testid="button-mobile-calendar"
            aria-label="Open calendar"
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover-elevate"
          >
            <Calendar className="h-4 w-4" />
          </button>
          <button
            onClick={onOpenSources}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs font-medium text-foreground hover-elevate sm:px-3"
            data-testid="button-sources"
            aria-label="Sources and about"
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sources & About</span>
          </button>
          <button
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover-elevate"
            data-testid="button-theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Desk tabs */}
      <nav
        aria-label="Newsroom desks"
        className="mx-auto w-full max-w-[1400px] overflow-x-auto px-4 md:px-6"
      >
        <ul className="flex items-center gap-1 pb-1 text-sm">
          {TABS.map((t) => {
            // "All" is active when no desk is selected.
            const active = t.id === "all"
              ? desks.size === 0
              : desks.has(t.id as DeskId);
            const underlineCls =
              t.id === "all" ? "bg-foreground" : `bg-desk-${t.id}`;
            return (
              <li key={t.id}>
                <button
                  onClick={() => handleDeskClick(t.id)}
                  aria-pressed={active}
                  data-testid={`tab-${t.id}`}
                  className={`relative whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t.label}
                  {active && (
                    <span
                      className={`absolute left-2 right-2 bottom-0 h-[2px] rounded-full ${underlineCls}`}
                    />
                  )}
                </button>
              </li>
            );
          })}
          <li className="ml-auto hidden md:flex items-center gap-1">
            <Link
              href={`/${currentCity.slug}/calendar`}
              className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground hover-elevate"
              data-testid="link-calendar"
            >
              Calendar
            </Link>
            <Link
              href={`/${currentCity.slug}/jobs`}
              className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground hover-elevate"
              data-testid="link-jobs"
            >
              Jobs
            </Link>
            <Link
              href="/admin"
              className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
              data-testid="link-admin"
            >
              Admin
            </Link>
          </li>
        </ul>
      </nav>
    </header>
    {/* Render the mobile calendar sheet OUTSIDE the header so it isn't trapped
        in the header's sticky stacking context. */}
    <MobileCalendarSheet open={mobileCalOpen} onOpenChange={setMobileCalOpen} />
    </>
  );
}
