/**
 * Phase 29: mobile-only collapsible Top Stories.
 *
 * On lg+ viewports the right-rail TopStories panel does the work.
 * On mobile the rail isn't rendered, so we expose the same content above
 * the chronological feed with a tap-to-collapse chevron. Starts expanded.
 * State is remembered in localStorage so a reader who collapses it stays
 * collapsed on their next visit.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { Story } from "@shared/schema";
import { type DeskId, relativeTime, DESK_META } from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { apiRequest } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";

const STORAGE_KEY = "zootown:mobileTopStoriesOpen";

interface Props {
  onOpenStory: (s: Story) => void;
  activeDesk?: "all" | DeskId;
}

export function MobileTopStories({ onOpenStory, activeDesk = "all" }: Props) {
  const { currentCity } = useCity();
  const citySlug = currentCity.slug;

  // Default: open on first visit; remember the user's choice after that.
  const [open, setOpen] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "0") setOpen(false);
    } catch {
      /* ignore */
    }
  }, []);
  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  const top = useQuery<Story[]>({
    queryKey: ["/api/top-stories", citySlug, activeDesk, "mobile"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/top-stories?city=${citySlug}&desk=${activeDesk}`,
      );
      return (await res.json()) as Story[];
    },
    enabled: open, // don't even fetch if collapsed
  });

  const isSingle = activeDesk !== "all";
  const heading = isSingle
    ? `Top in ${DESK_META[activeDesk as DeskId]?.short ?? activeDesk}`
    : "Top stories";

  return (
    <section
      aria-labelledby="m-top-heading"
      className="lg:hidden rounded-lg border border-card-border bg-card overflow-hidden"
    >
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover-elevate"
        data-testid="mobile-top-stories-toggle"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2
            id="m-top-heading"
            className="font-mono text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground"
          >
            {heading}
          </h2>
          <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground/60 truncate">
            {isSingle ? "Best 5 / 7 days" : "Best of the week"}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open && (
        <ul className="px-4 pb-4 space-y-3">
          {(top.data ?? []).map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onOpenStory(s)}
                className="w-full text-left rounded-md px-1 py-1 hover-elevate"
                data-testid={`mobile-top-${s.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <DeskBadge desk={s.desk as DeskId} />
                    <span className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-muted-foreground/70">
                      {relativeTime(s.publishedAt)}
                    </span>
                  </div>
                  <h3 className="mt-1 font-serif text-[0.98rem] leading-snug font-semibold text-foreground line-clamp-2">
                    {s.headline}
                  </h3>
                </div>
              </button>
            </li>
          ))}
          {!top.isLoading && (top.data ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground py-2">
              Nothing surfaced yet this week.
            </li>
          )}
          {top.isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="animate-pulse">
                <div className="space-y-2">
                  <div className="h-3 w-12 rounded bg-muted" />
                  <div className="h-4 w-full rounded bg-muted" />
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
