import { Wordmark } from "./Logo";
import { useTheme } from "@/lib/theme";
import { Search, Sun, Moon, Info, MapPin } from "lucide-react";
import { type DeskId, DESK_META } from "@/lib/format";
import { Link, useLocation } from "wouter";

interface Props {
  desk: "all" | DeskId;
  onDeskChange: (d: "all" | DeskId) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenSources: () => void;
  lastUpdatedLabel: string;
}

const TABS: Array<{ id: "all" | DeskId; label: string }> = [
  { id: "all", label: "All" },
  { id: "city", label: "City" },
  { id: "business", label: "Business" },
  { id: "crime", label: "Crime" },
  { id: "sports", label: "Sports" },
  { id: "health", label: "Health" },
  { id: "events", label: "Events" },
  { id: "politics", label: "Politics" },
  { id: "people", label: "People" },
  { id: "history", label: "History" },
  { id: "science_tech", label: "Science Tech" },
];

export function TopBar({
  desk,
  onDeskChange,
  query,
  onQueryChange,
  onOpenSources,
  lastUpdatedLabel,
}: Props) {
  const { theme, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const onHome = location === "/" || location === "";

  // When user clicks a desk tab from a non-home page (Calendar, Jobs, Admin),
  // route them home and pre-select the desk via hash search-param so the
  // feed loads filtered to that desk. This stops the "stuck on Calendar" feel.
  function handleDeskChange(id: "all" | DeskId) {
    if (onHome) {
      onDeskChange(id);
    } else {
      // Stash the requested desk on the window so Home can pick it up on mount,
      // then route home. (wouter's hash router treats `?` as part of the path,
      // so we cannot smuggle a query string through the URL.)
      if (typeof window !== "undefined") {
        (window as any).__pendingDesk = id;
      }
      navigate("/");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-5 md:px-6 lg:py-3.5">
        {/* Left: logo + location */}
        <div className="flex items-center gap-3">
          <Link href="/" data-testid="link-home" className="shrink-0">
            <Wordmark />
          </Link>
          <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            <MapPin className="h-3 w-3" />
            Missoula, MT
          </span>
          <span
            className="hidden sm:inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-destructive pulse-dot"
            title={lastUpdatedLabel}
            data-testid="chip-live"
          >
            <span className="hidden lg:inline">Live · updates every 5 min</span>
            <span className="lg:hidden">Live</span>
          </span>
        </div>

        {/* Right: search + actions */}
        <div className="flex items-center gap-2">
          <label className="relative flex-1 md:w-[320px] md:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search Missoula…"
              aria-label="Search"
              data-testid="input-search"
              className="w-full rounded-md border border-input bg-background/80 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </label>
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
            const active = desk === t.id;
            const underlineCls =
              t.id === "all" ? "bg-foreground" : `bg-desk-${t.id}`;
            return (
              <li key={t.id}>
                <button
                  onClick={() => handleDeskChange(t.id)}
                  aria-current={active ? "page" : undefined}
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
              href="/calendar"
              className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground hover-elevate"
              data-testid="link-calendar"
            >
              Calendar
            </Link>
            <Link
              href="/jobs"
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
  );
}
