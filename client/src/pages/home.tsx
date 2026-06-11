import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Story } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import { TopBar } from "@/components/TopBar";
import { RightRail } from "@/components/RightRail";
import { StoryCard, StoryCardSkeleton } from "@/components/StoryCard";
import { StoryDrawer } from "@/components/StoryDrawer";
import { SourcesDialog } from "@/components/SourcesDialog";
import { Weather } from "@/components/Weather";
import { DESK_META, type DeskId, parseTags, relativeTime } from "@/lib/format";
import { ArrowUp, X } from "lucide-react";

interface StoriesPage {
  items: Story[];
  nextCursor: number | null;
  total: number;
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
  const { currentCity } = useCity();
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

  const displayItems = isHistoryDesk
    ? historyAsStories
    : isPeopleDesk
    ? peopleDisplay
    : isEventsDesk
    ? eventsItems
    : items;
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
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h1 className="font-serif text-[1.65rem] leading-tight font-semibold tracking-tight text-foreground">
                  {(() => {
                    if (selectedDesks.size === 0) return `Live from ${currentCity.displayName}`;
                    if (selectedDesks.size === 1) {
                      const only = sortedDesks[0] as DeskId;
                      return DESK_META[only]?.label ?? only;
                    }
                    // Multi-select: list desk labels joined with ' + '
                    return sortedDesks
                      .map((d) => DESK_META[d as DeskId]?.label ?? d)
                      .join(" + ");
                  })()}
                </h1>
                {isHistoryDesk && (
                  <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Curated stories · rotated weekly · rooted in archival fact
                  </p>
                )}
                {isEventsDesk && (
                  <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Upcoming events · sorted by date · past events hidden
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {isLoading && displayItems.length === 0
                    ? "Loading feed…"
                    : `${total} posts${debounced ? ` matching "${debounced}"` : ""}`}
                </p>
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

            <div className="space-y-3">
              {displayItems.map((s) => (
                <StoryCard key={s.id} story={s} onOpen={setSelected} />
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
