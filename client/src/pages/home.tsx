import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Story } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import { TopBar } from "@/components/TopBar";
import { RightRail } from "@/components/RightRail";
import { StoryCard, StoryCardSkeleton } from "@/components/StoryCard";
import { Fragment } from "react";
import { useLocation, useRoute } from "wouter";
import { StoryDrawer } from "@/components/StoryDrawer";
import { SponsorBanner } from "@/components/SponsorBanner";
import {
  shouldShowSponsorAfter,
  bannerSlotForIndex,
  pickSponsorForSlot,
} from "@/lib/sponsors";
import { SourcesDialog } from "@/components/SourcesDialog";
import { Weather } from "@/components/Weather";
import { DESK_META, type DeskId, parseTags, relativeTime } from "@/lib/format";
import { ArrowUp, X } from "lucide-react";

interface StoriesPage {
  items: Story[];
  nextCursor: number | null;
  total: number;
}

/**
 * Break up runs of same-desk cards so the feed never shows the same category
 * twice in a row when a different-category card is available later.
 *
 * Greedy interleaver: walk the input in order (already sorted newest-first),
 * always pick the earliest item whose desk ≠ the last placed desk. If every
 * remaining item shares the previous desk, fall through and just append them
 * in order — we never reorder past necessity, so the chronological feel is
 * preserved and a long-tail of same-desk events at the end still renders.
 *
 * O(n^2) worst case but n is the page size (≤ ~50), so it's a non-issue.
 */
function interleaveByDesk<T extends { desk: string | null | undefined }>(
  arr: readonly T[],
): T[] {
  if (arr.length < 2) return arr.slice();
  const remaining = arr.slice();
  const out: T[] = [];
  let lastDesk: string | null = null;
  while (remaining.length > 0) {
    // First try to find the earliest item with a different desk than the
    // previous card. If none exists (everything left is same-desk), just
    // take the first remaining item.
    let pickIdx = 0;
    if (lastDesk !== null) {
      const idx = remaining.findIndex((it) => (it.desk ?? "") !== lastDesk);
      if (idx >= 0) pickIdx = idx;
    }
    const [picked] = remaining.splice(pickIdx, 1);
    out.push(picked);
    lastDesk = picked.desk ?? "";
  }
  return out;
}

interface HistoryStory {
  id: number;
  headline: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string;
  lastBumpedAt: string;
}

const VALID_DESKS = [
  "all", "city", "business", "crime", "sports", "health",
  "entertainment", "people", "history",
] as const;

function readPendingDesk(): "all" | DeskId {
  if (typeof window === "undefined") return "all";
  const w = window as any;
  if (typeof w.__pendingDesk === "string" && VALID_DESKS.includes(w.__pendingDesk)) {
    const d = w.__pendingDesk;
    w.__pendingDesk = undefined;
    return d as "all" | DeskId;
  }
  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  if (qIndex < 0) return "all";
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const d = params.get("desk");
  return VALID_DESKS.includes((d ?? "") as any) ? (d as "all" | DeskId) : "all";
}

// Convert the pending desk signal into the initial Set state. "all" => empty Set.
function initialDeskSet(): Set<DeskId> {
  const d = readPendingDesk();
  return d === "all" ? new Set() : new Set([d as DeskId]);
}

export default function Home() {
  const { currentCity, cities } = useCity();
  const citySlug = currentCity.slug;

  // Multi-select set of desks. Empty set == "All" (no filter).
  const [selectedDesks, setSelectedDesks] = useState<Set<DeskId>>(() => initialDeskSet());

  // Toggle a desk in/out of the selection. Pass null to clear (= "All").
  const toggleDesk = (d: DeskId | null) => {
    setSelectedDesks((prev) => {
      if (d === null) return new Set();
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  useEffect(() => {
    function onHashChange() {
      const next = readPendingDesk();
      if (next !== "all") setSelectedDesks(new Set([next as DeskId]));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<Story[]>([]);
  const [selected, setSelected] = useState<Story | null>(null);

  // ---- Story deep links ----
  // When the URL is /:city/story/:storyId, auto-open the drawer to that
  // story. Push the route back to /:city when the drawer closes so the
  // back button does the right thing. Lets users share a link that lands
  // straight on the article instead of an empty city feed.
  const [, navigate] = useLocation();
  const [matchStory, storyParams] = useRoute("/:city/story/:storyId");
  const deepLinkStoryId =
    matchStory && storyParams?.storyId ? Number(storyParams.storyId) : null;
  const deepLinkCitySlug =
    matchStory && storyParams?.city ? storyParams.city.toLowerCase() : null;

  // When a recipient arrives via a shared-link URL (?from_story=NNN), strip
  // that query string from the address bar after the page loads. The OG
  // preview was already rendered server-side by api/story-preview.ts; the
  // SPA itself doesn't need the param. Doing this keeps the visible URL
  // clean (zootownhub.com/missoula) so the next reload doesn't keep the
  // tracking param around.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("from_story")) {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", cleanUrl);
    }
  }, []);

  // Fetch the deep-link story if we don't already have it loaded. Also
  // verify the URL's city slug matches the story's actual city -- if a
  // user tapped a /billings/story/X link while their PWA was on Missoula,
  // we need to switch to Billings on arrival so the feed underneath
  // matches the open drawer.
  useEffect(() => {
    if (deepLinkStoryId === null) return;
    if (selected && selected.id === deepLinkStoryId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stories/${deepLinkStoryId}`);
        if (!res.ok) return;
        const story = (await res.json()) as Story;
        if (cancelled) return;
        setSelected(story);
      } catch {
        /* network blip — user can still browse the feed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkStoryId, selected]);

  // If the deep-link URL says one city but the story belongs to another,
  // navigate to the story's correct city. Two cases:
  //   1. The shared URL has the wrong slug because the sharer was viewing
  //      a related cross-city story from a different city's feed.
  //   2. The PWA opened with a stale wouter location pointing at a
  //      different city (Missoula default, etc.).
  // The CityProvider reads citySlug from the URL, so navigating fixes
  // the city header / weather / filter scope automatically.
  useEffect(() => {
    if (!selected) return;
    if (!deepLinkCitySlug) return;
    const cityRow = cities.find((c) => c.id === selected.cityId);
    if (!cityRow) return;
    const correctSlug = cityRow.slug.toLowerCase();
    if (correctSlug !== deepLinkCitySlug) {
      navigate(`/${correctSlug}/story/${selected.id}`, { replace: true });
    }
  }, [selected, deepLinkCitySlug, cities, navigate]);

  // Mirror selected -> URL: when a card is clicked, push the deep-link route
  // so the URL reflects what the user is viewing and the link is shareable
  // straight from the address bar. Use the STORY'S own city slug, not the
  // currently-viewed city, so cross-city shares are correct.
  useEffect(() => {
    if (selected) {
      const storyCity = cities.find((c) => c.id === selected.cityId);
      const targetSlug = storyCity?.slug ?? citySlug;
      const target = `/${targetSlug}/story/${selected.id}`;
      if (window.location.pathname !== target) {
        navigate(target, { replace: false });
      }
    } else if (matchStory) {
      navigate(`/${citySlug}`, { replace: false });
    }
  }, [selected, matchStory, citySlug, navigate, cities]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [newPostsCount, setNewPostsCount] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  // Sorted, stable representation of the desk selection — used in query keys
  // + URL param so the same combo always hits the same cache entry.
  const sortedDesks = useMemo(
    () => [...selectedDesks].sort(),
    [selectedDesks],
  );
  const desksParam = sortedDesks.join(",");

  // Single-desk "section" modes (history pool, sorted-by-event-date, etc.)
  // only apply when EXACTLY that desk is selected on its own. Once a user
  // multi-selects, we drop back to the regular news-feed treatment.
  const isHistoryDesk = selectedDesks.size === 1 && selectedDesks.has("history");
  const isPeopleDesk = selectedDesks.size === 1 && selectedDesks.has("people");
  const isEventsDesk = selectedDesks.size === 1 && selectedDesks.has("entertainment");

  useEffect(() => {
    setCursor(0);
    setItems([]);
    setNewPostsCount(0);
  }, [desksParam, debounced, citySlug]);

  const historyQuery = useQuery<HistoryStory[]>({
    queryKey: ["/api/history", isPeopleDesk ? "people" : "history", citySlug],
    queryFn: async () => {
      const deskParam = isPeopleDesk ? "people" : "history";
      const res = await apiRequest("GET", `/api/history?desk=${deskParam}&city=${citySlug}`);
      return (await res.json()) as HistoryStory[];
    },
    enabled: isHistoryDesk || isPeopleDesk,
  });

  // Regular feed query — used for everything except the dedicated single-desk
  // history mode. Empty desksParam == "all". Comma-separated list when multi-select.
  const feed = useQuery<StoriesPage>({
    queryKey: ["/api/stories", { desks: desksParam, q: debounced, cursor, limit: 12, city: citySlug }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (desksParam) params.set("desks", desksParam);
      if (debounced) params.set("q", debounced);
      params.set("limit", "12");
      params.set("cursor", String(cursor));
      params.set("city", citySlug);
      const res = await apiRequest("GET", `/api/stories?${params.toString()}`);
      return (await res.json()) as StoriesPage;
    },
    enabled: !isHistoryDesk,
  });

  useEffect(() => {
    if (feed.data && !isHistoryDesk) {
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const next = [...prev];
        for (const it of feed.data!.items) if (!seen.has(it.id)) next.push(it);
        return next;
      });
    }
  }, [feed.data, isHistoryDesk]);

  // Pulse / live refresh
  const latestSeenRef = useRef<string | null>(null);
  const { data: pulse } = useQuery<{
    latestPublishedAt: string | null;
    total: number;
    nextCheckInSeconds: number;
    ingestionCadenceMinutes: number;
    serverTime: string;
  }>({
    queryKey: ["/api/pulse", citySlug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pulse?city=${citySlug}`);
      return (await res.json()) as any;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!pulse) return;
    if (!latestSeenRef.current) {
      latestSeenRef.current = pulse.latestPublishedAt;
      return;
    }
    if (pulse.latestPublishedAt && pulse.latestPublishedAt !== latestSeenRef.current) {
      setNewPostsCount((c) => c + 1);
    }
  }, [pulse]);

  const loadMore = () => {
    if (feed.data?.nextCursor != null) setCursor(feed.data.nextCursor);
  };

  const refreshForNew = async () => {
    latestSeenRef.current = pulse?.latestPublishedAt ?? null;
    setNewPostsCount(0);
    setCursor(0);
    setItems([]);
    await queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
  };

  const related = useMemo<Story[]>(() => {
    if (!selected) return [];
    const selectedTags = new Set(parseTags(selected.tags));
    return items
      .filter((s) => s.id !== selected.id)
      .map((s) => ({ s, score: parseTags(s.tags).filter((t) => selectedTags.has(t)).length }))
      .filter((x) => x.score > 0 || x.s.desk === selected.desk)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.s);
  }, [selected, items]);

  const lastUpdatedLabel = pulse?.serverTime
    ? `Last checked ${relativeTime(pulse.serverTime)}`
    : "Checking…";

  // Convert history stories to Story-shaped objects for StoryCard
  const historyAsStories: Story[] = useMemo(() => {
    if (!historyQuery.data) return [];
    return historyQuery.data.map((h) => {
      const stripped = h.summary.replace(/^#+\s+[^\n]+\n+/, "").trim();
      const firstPara = stripped.split(/\n{2,}/)[0] ?? stripped;
      const preview = firstPara.length > 320 ? firstPara.slice(0, 320).trim() + "…" : firstPara;
      const deskId = (h.desk ?? "history") as "history" | "people";
      const baseTags = deskId === "people" ? ["people", citySlug] : ["history", citySlug];
      const kindTag = h.kind && h.kind !== "history" ? [h.kind] : [];
      const sourceName = h.sourceUrl && /wikipedia\.org/i.test(h.sourceUrl) ? "Wikipedia" : "ZooTown History";
      return ({
      id: h.id,
      headline: h.headline,
      summary: preview,
      body: h.summary, // full markdown body for the drawer
      whyItMatters: null,
      desk: deskId,
      tags: JSON.stringify([...baseTags, ...kindTag]),
      sourceName,
      sourceUrl: h.sourceUrl ?? "https://zootown.pplx.app",
      sourceType: deskId === "people" ? "Profile" : "Official",
      publishedAt: h.lastBumpedAt,
      fetchedAt: h.publishedAt,
      location: `${currentCity.displayName}, ${currentCity.state}`,
      status: null,
      riskLevel: "low",
      isSeeded: true,
      modState: "approved" as const,
      politicalScope: null,
      eventDate: null,
    }) as Story & { body: string };
    });
  }, [historyQuery.data]);

  // People desk merges long-form (history pool) with ingested people stories
  const peopleDisplay: Story[] = useMemo(() => {
    if (!isPeopleDesk) return items;
    const longForm = historyAsStories;
    const seen = new Set(longForm.map((s) => s.headline.toLowerCase()));
    const rest = items.filter((s) => !seen.has(s.headline.toLowerCase()));
    return [...longForm, ...rest];
  }, [isPeopleDesk, items, historyAsStories]);

  // Events desk: sort by eventDate ascending, hide past events
  const eventsItems = useMemo(() => {
    if (!isEventsDesk) return items;
    const now = new Date();
    return items
      .filter((s) => !s.eventDate || new Date(s.eventDate) >= now)
      .sort((a, b) => {
        if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
        if (a.eventDate) return -1;
        if (b.eventDate) return 1;
        return b.publishedAt.localeCompare(a.publishedAt);
      });
  }, [items, isEventsDesk]);

  // Choose the right list per active filter, then apply the "no two
  // same-category cards in a row" interleaver. We DO NOT interleave the
  // calendar/events tab (those are chronological by start time and that
  // ordering is more important than category variety), and we skip the
  // single-desk people/history tabs (every card shares a desk by definition).
  const baseItems = isHistoryDesk
    ? historyAsStories
    : isPeopleDesk
    ? peopleDisplay
    : isEventsDesk
    ? eventsItems
    : items;
  const displayItems = useMemo(() => {
    if (isHistoryDesk || isPeopleDesk || isEventsDesk) return baseItems;
    return interleaveByDesk(baseItems);
  }, [baseItems, isHistoryDesk, isPeopleDesk, isEventsDesk]);
  const isLoading = isHistoryDesk ? historyQuery.isLoading : feed.isLoading;
  const total = isHistoryDesk
    ? historyAsStories.length
    : isPeopleDesk
    ? peopleDisplay.length
    : (feed.data?.total ?? items.length);

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        desks={selectedDesks}
        onDeskToggle={toggleDesk}
        query={query}
        onQueryChange={setQuery}
        onOpenSources={() => setSourcesOpen(true)}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <Weather />

      {newPostsCount > 0 && (
        <div className="sticky top-[96px] z-30 flex justify-center px-4 pt-3">
          <button
            onClick={refreshForNew}
            className="group inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-md hover-elevate active-elevate-2"
            data-testid="button-new-posts"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            {newPostsCount} new {newPostsCount === 1 ? "post" : "posts"} · refresh
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
          <section aria-label="Live feed">
            {/*
              Section heading ("Business Desk · 4 posts") removed so the first
              card lines up flush with the top of the Top Stories sidebar.
              The active filter is already obvious from the underlined tab
              in the top bar, and the card count is visible on screen. We
              still surface the small functional bits:
                - history/events descriptor lines (mode-specific behavior)
                - search-active "clear" pill (only when a query is active)
                - search-result count (only when a query is active)
            */}
            {(isHistoryDesk || isEventsDesk || debounced) && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-1">
                  {isHistoryDesk && (
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Curated stories · rotated weekly · rooted in archival fact
                    </p>
                  )}
                  {isEventsDesk && (
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Upcoming events · sorted by date · past events hidden
                    </p>
                  )}
                  {debounced && (
                    <p className="text-xs text-muted-foreground">
                      {isLoading && displayItems.length === 0
                        ? "Searching…"
                        : `${total} ${total === 1 ? "post" : "posts"} matching "${debounced}"`}
                    </p>
                  )}
                </div>
                {debounced && (
                  <button
                    onClick={() => setQuery("")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate"
                  >
                    <X className="h-3 w-3" />
                    Clear search
                  </button>
                )}
              </div>
            )}

            <div className="space-y-3">
              {displayItems.map((s, idx) => (
                <Fragment key={s.id}>
                  <StoryCard story={s} onOpen={setSelected} />
                  {/* Sponsor banner rule (lib/sponsors.ts): attach a banner to
                      the bottom of the 2nd post (idx=1), then every 3rd post
                      after that (4, 7, 10, ...). Rotates round-robin through
                      sponsors eligible for the current city. Hidden on the
                      single-desk People/History/Events tabs and during search
                      where the feed is short and rule arithmetic feels off. */}
                  {shouldShowSponsorAfter(idx) &&
                    !isHistoryDesk &&
                    !isPeopleDesk &&
                    !isEventsDesk &&
                    !debounced &&
                    (() => {
                      const slot = bannerSlotForIndex(idx);
                      const sponsor = pickSponsorForSlot(citySlug, slot);
                      if (!sponsor) return null;
                      return <SponsorBanner sponsor={sponsor} />;
                    })()}
                </Fragment>
              ))}

              {isLoading && displayItems.length === 0 && (
                <>
                  <StoryCardSkeleton />
                  <StoryCardSkeleton />
                  <StoryCardSkeleton />
                  <StoryCardSkeleton />
                </>
              )}

              {!isLoading && displayItems.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
                  <p className="font-serif text-lg text-foreground">No posts match this filter.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try another desk or clear your search.
                  </p>
                </div>
              )}

              {!isHistoryDesk && feed.data?.nextCursor != null && items.length > 0 && (
                <div className="pt-3">
                  <button
                    onClick={loadMore}
                    disabled={feed.isFetching}
                    className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover-elevate active-elevate-2 disabled:opacity-60"
                    data-testid="button-load-more"
                  >
                    {feed.isFetching ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}

              {!isHistoryDesk && feed.data?.nextCursor == null && items.length > 0 && (
                <div className="py-6 text-center">
                  <div className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                    — End of feed —
                  </div>
                </div>
              )}

              {isHistoryDesk && historyAsStories.length > 0 && (
                <div className="py-6 text-center">
                  <div className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                    — {historyAsStories.length} history stories · rotated weekly —
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="lg:block">
            <div className="sticky top-[128px]">
              <RightRail
                onOpenStory={setSelected}
                onSelectTag={(t) => setQuery(t)}
                onOpenSources={() => setSourcesOpen(true)}
              />
            </div>
          </div>
        </div>

        <footer className="mx-auto mt-16 max-w-[1400px] border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
            <div>
              ZooTown · AI-assisted local aggregation for {currentCity.displayName}, {currentCity.state}. We summarize, we don't
              republish.
            </div>
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em]">
              Prototype · seeded data · {pulse?.ingestionCadenceMinutes ?? 5}-min ingest target
            </div>
          </div>
        </footer>
      </main>

      <StoryDrawer
        story={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        related={related}
        onOpenRelated={(s) => setSelected(s)}
      />
      <SourcesDialog open={sourcesOpen} onOpenChange={setSourcesOpen} />
    </div>
  );
}
