/**
 * Phase 25: the new admin cockpit.
 *
 * Single-screen replacement for the old 9-tab admin. The legacy page is
 * parked at /admin/legacy. This view's job is one thing: surface what
 * needs the admin's attention, in plain language, with one click to act.
 *
 * Components (all in this file for now -- split out when any grows past
 * the page boundary):
 *   - NeedsYouNow:    summary banner with clickable filter chips
 *   - CockpitFilters: city, sort, quick-filter chips, search
 *   - CockpitFeed:    the story list with signal column + edit/hide +
 *                     chat stub (Phase 26 will wire the LLM)
 *   - SettingsDrawer: collapsible "system internals" panel
 *
 * Editorial intent (per Cody, June 14):
 *   - Looks like the public site so the admin judges stories the way
 *     readers see them.
 *   - Default sort = attention score (reports dominate, dislikes are a
 *     tie-breaker, never the primary driver).
 *   - Settings hidden by default. Most days the admin should never have
 *     to open it.
 */
import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  apiRequest,
  queryClient,
  getAdminToken,
  setAdminToken,
  subscribeAdminToken,
} from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { DeskBadge } from "@/components/DeskBadge";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { AdminCityProvider, useAdminCity } from "@/lib/admin-city-context";
import { AdminCitySwitcher } from "@/components/admin/AdminCitySwitcher";
import {
  type DeskId,
  relativeTime,
  absoluteDate,
  formatEventRange,
} from "@/lib/format";
import {
  Eye, ThumbsUp, ThumbsDown, Flag, Share2, AlertTriangle,
  Search, Settings as SettingsIcon, X, MessageSquare, Pencil,
  EyeOff, ExternalLink, LogOut, ChevronRight, Calendar, ArrowLeft,
  FileText, Check, ChevronLeft,
} from "lucide-react";

// --- Types ---

interface CockpitItem {
  id: number;
  headline: string;
  summary: string;
  desk: string;
  source_name: string;
  source_url: string;
  source_type: string;
  published_at: string;
  city_id: number | null;
  mod_state: string;
  on_calendar: boolean;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  is_obituary: boolean;
  is_synthesis: boolean;
  is_people_profile: boolean;
  is_sports_recap: boolean;
  view_count: number;
  like_count: number;
  dislike_count: number;
  share_count: number;
  report_count: number;
  brigade_flag: boolean;
  brigade_reason: string | null;
  has_open_audit: boolean;
}

interface Summary {
  reports: number;
  brigade: number;
  audits_open: number;
  audits_high: number;
  drafts: number;
  fresh_24h: number;
}

type FilterId = "all" | "reports" | "brigade" | "drafts" | "audits" | "fresh24h";
type SortId = "attention" | "newest" | "most_disliked";

// --- Page shell ---

export default function CockpitPage() {
  const [token, setToken] = useState<string | null>(getAdminToken());
  useEffect(() => subscribeAdminToken((t) => setToken(t)), []);
  if (!token) return <AdminLogin />;
  return (
    <AdminCityProvider>
      <CockpitInner />
    </AdminCityProvider>
  );
}

function CockpitInner() {
  const { currentCity } = useAdminCity();
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("attention");
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <CockpitTopBar onOpenSettings={() => setShowSettings(true)} />

      <main className="mx-auto max-w-[1100px] px-6 py-6 space-y-6">
        <NeedsYouNow
          citySlug={currentCity.slug}
          activeFilter={filter}
          onSelectFilter={setFilter}
        />

        <CockpitFilters
          filter={filter}
          sort={sort}
          search={search}
          onFilter={setFilter}
          onSort={setSort}
          onSearch={setSearch}
        />

        <CockpitFeed
          citySlug={currentCity.slug}
          filter={filter}
          sort={sort}
          search={search}
        />
      </main>

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// --- Top bar ---

function CockpitTopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const handleLogout = async () => {
    try { await apiRequest("POST", "/api/admin/logout"); } catch { /* ignore */ }
    setAdminToken(null);
  };
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover-elevate rounded-md p-1 -ml-1">
            <Wordmark />
          </Link>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            · Cockpit
          </span>
          <div className="ml-2">
            <AdminCitySwitcher />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card px-2.5 py-1.5 text-xs hover-elevate"
            data-testid="cockpit-open-settings"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card px-2.5 py-1.5 text-xs hover-elevate text-muted-foreground"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}

// --- Needs you now banner ---

function NeedsYouNow({
  citySlug,
  activeFilter,
  onSelectFilter,
}: {
  citySlug: string;
  activeFilter: FilterId;
  onSelectFilter: (f: FilterId) => void;
}) {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["cockpit-summary", citySlug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/cockpit/summary?city=${citySlug}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const chips: Array<{ id: FilterId; label: string; count: number; tone: string }> = [
    { id: "reports", label: "reports", count: data?.reports ?? 0, tone: "red" },
    { id: "brigade", label: "brigade flagged", count: data?.brigade ?? 0, tone: "amber" },
    { id: "audits", label: "audit issues", count: data?.audits_open ?? 0, tone: "amber" },
    { id: "drafts", label: "drafts", count: data?.drafts ?? 0, tone: "slate" },
    { id: "fresh24h", label: "new (24h)", count: data?.fresh_24h ?? 0, tone: "slate" },
  ];

  const anythingHot = (data?.reports ?? 0) + (data?.brigade ?? 0) + (data?.audits_high ?? 0) > 0;

  return (
    <section
      className={`rounded-lg border p-4 ${
        anythingHot
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-card-border bg-card"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-lg">
          {anythingHot ? "Needs you now" : "Looking quiet"}
        </h2>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
          live · updates every 30s
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {anythingHot
          ? "Click a chip to focus the feed on the rows behind these numbers."
          : "No reports, no brigade flags, no urgent audit findings. Browse the feed when you have a moment."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <SummaryChip
            key={c.id}
            label={c.label}
            count={c.count}
            tone={c.tone}
            active={activeFilter === c.id}
            onClick={() => onSelectFilter(activeFilter === c.id ? "all" : c.id)}
            disabled={isLoading}
          />
        ))}
      </div>
    </section>
  );
}

function SummaryChip({ label, count, tone, active, onClick, disabled }: {
  label: string; count: number; tone: string;
  active: boolean; onClick: () => void; disabled?: boolean;
}) {
  const muted = count === 0;
  const toneClass =
    tone === "red"
      ? muted ? "text-muted-foreground" : "text-red-500"
      : tone === "amber"
      ? muted ? "text-muted-foreground" : "text-amber-500"
      : "text-foreground";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={`chip-${label.replace(/\s+/g, "-")}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-foreground/30 bg-foreground/10"
          : "border-card-border bg-card hover-elevate"
      } ${muted ? "opacity-60" : ""}`}
    >
      <span className={`font-mono tabular-nums font-bold ${toneClass}`}>{count}</span>
      <span>{label}</span>
    </button>
  );
}

// --- Filter bar ---

function CockpitFilters({
  filter, sort, search, onFilter, onSort, onSearch,
}: {
  filter: FilterId; sort: SortId; search: string;
  onFilter: (f: FilterId) => void;
  onSort: (s: SortId) => void;
  onSearch: (s: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-card-border bg-card p-3">
      <div className="flex items-center gap-1">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mr-1">Showing</span>
        {([
          ["all", "All"],
          ["reports", "Reported"],
          ["brigade", "Brigade"],
          ["audits", "Audit"],
          ["drafts", "Drafts"],
          ["fresh24h", "24h"],
        ] as [FilterId, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => onFilter(id)}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              filter === id
                ? "border-foreground/30 bg-foreground/10"
                : "border-card-border bg-card hover-elevate text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 ml-2">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mr-1">Sort</span>
        {([
          ["attention", "Needs attention"],
          ["newest", "Newest"],
          ["most_disliked", "Most disliked"],
        ] as [SortId, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => onSort(id)}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              sort === id
                ? "border-foreground/30 bg-foreground/10"
                : "border-card-border bg-card hover-elevate text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ms-auto relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search headline or source..."
          className="rounded-md border border-card-border bg-background pl-7 pr-2 py-1 text-xs w-64 max-w-full"
        />
      </div>
    </div>
  );
}

// --- Feed ---

function CockpitFeed({
  citySlug, filter, sort, search,
}: {
  citySlug: string; filter: FilterId; sort: SortId; search: string;
}) {
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<{ items: CockpitItem[] }>({
    queryKey: ["cockpit-feed", citySlug, filter, sort, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        city: citySlug,
        filter, sort,
        search: debouncedSearch,
        limit: "30",
      });
      const res = await apiRequest("GET", `/api/admin/cockpit/feed?${params.toString()}`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg border border-card-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm">
        Could not load feed. Try refreshing.
      </div>
    );
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nothing matches these filters.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <CockpitStoryCard key={item.id} item={item} />
      ))}
    </div>
  );
}

// --- One story card ---

type CardPanel = "none" | "chat" | "drafts";

function CockpitStoryCard({ item }: { item: CockpitItem }) {
  const [panel, setPanel] = useState<CardPanel>("none");
  const desk = item.desk as DeskId;
  const isUpcomingEvent = !!(item.on_calendar && item.starts_at);

  const hide = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/stories/${item.id}`, {
        modState: "rejected",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cockpit-feed"] });
      queryClient.invalidateQueries({ queryKey: ["cockpit-summary"] });
    },
  });

  const attentionBadges: Array<{ label: string; tone: string; title?: string }> = [];
  if (item.report_count > 0) {
    attentionBadges.push({
      label: `${item.report_count} report${item.report_count === 1 ? "" : "s"}`,
      tone: "red",
    });
  }
  if (item.brigade_flag) {
    attentionBadges.push({
      label: "brigade pattern",
      tone: "amber",
      title: item.brigade_reason ?? undefined,
    });
  }
  if (item.has_open_audit) {
    attentionBadges.push({ label: "audit flag", tone: "amber" });
  }
  if (item.mod_state === "draft") {
    attentionBadges.push({ label: "draft", tone: "slate" });
  }

  return (
    <article
      data-testid={`cockpit-story-${item.id}`}
      className="relative rounded-lg border border-card-border bg-card p-5 transition-shadow"
    >
      <div className={`absolute left-0 top-5 bottom-5 w-[3px] rounded-r bg-desk-${desk}`} />

      <div className="flex items-center gap-2 text-muted-foreground">
        <DeskBadge desk={desk} />
        {isUpcomingEvent && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border border-[hsl(var(--desk-${desk}))]/40 bg-[hsl(var(--desk-${desk}))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.14em] text-[hsl(var(--desk-${desk}))]`}
            title={`Upcoming event: ${formatEventRange(item.starts_at!, item.ends_at)}`}
          >
            <Calendar className="h-3 w-3" />
            Event
          </span>
        )}
        <span className="text-[0.68rem] font-mono uppercase tracking-[0.14em] text-muted-foreground/70">·</span>
        <time
          title={absoluteDate(item.published_at)}
          className="text-xs font-mono text-muted-foreground"
        >
          {relativeTime(item.published_at)}
        </time>

        {attentionBadges.map((b, i) => (
          <span
            key={i}
            title={b.title}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.14em] ${
              b.tone === "red"
                ? "border-red-500/40 bg-red-500/10 text-red-500"
                : b.tone === "amber"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-card-border bg-secondary/30 text-muted-foreground"
            }`}
          >
            {b.tone === "red" && <Flag className="h-3 w-3" />}
            {b.tone === "amber" && <AlertTriangle className="h-3 w-3" />}
            {b.label}
          </span>
        ))}

        <div className="ms-auto flex items-center gap-3">
          <SignalColumn item={item} />
        </div>
      </div>

      <h3 className="mt-3 font-serif text-[1.1rem] leading-snug font-semibold text-foreground">
        {isUpcomingEvent && item.starts_at && (
          <span
            className={`mr-1 font-mono text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[hsl(var(--desk-${desk}))]`}
          >
            {formatEventRange(item.starts_at, item.ends_at)} -{" "}
          </span>
        )}
        {item.headline}
      </h3>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-muted-foreground line-clamp-3">
        {item.summary}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
        >
          <span className="truncate">{item.source_name}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPanel((p) => (p === "chat" ? "none" : "chat"))}
            data-testid={`chat-toggle-${item.id}`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
              panel === "chat"
                ? "border-foreground/30 bg-foreground/10"
                : "border-card-border bg-card hover-elevate text-muted-foreground"
            }`}
            title="Chat with AI about this story"
          >
            <MessageSquare className="h-3 w-3" />
            chat
          </button>
          <button
            onClick={() => setPanel((p) => (p === "drafts" ? "none" : "drafts"))}
            data-testid={`drafts-toggle-${item.id}`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
              panel === "drafts"
                ? "border-foreground/30 bg-foreground/10"
                : "border-card-border bg-card hover-elevate text-muted-foreground"
            }`}
            title="View draft history"
          >
            <FileText className="h-3 w-3" />
            drafts
          </button>
          <button
            onClick={() => alert("Edit modal coming in the next pass.")}
            className="inline-flex items-center gap-1 rounded-md border border-card-border bg-card px-2 py-1 text-xs text-muted-foreground hover-elevate"
            title="Edit story"
          >
            <Pencil className="h-3 w-3" />
            edit
          </button>
          <button
            onClick={() => {
              if (confirm(`Hide story #${item.id}?`)) hide.mutate();
            }}
            disabled={hide.isPending}
            data-testid={`hide-${item.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-card-border bg-card px-2 py-1 text-xs text-muted-foreground hover-elevate disabled:opacity-50"
            title="Hide (mod_state=rejected)"
          >
            <EyeOff className="h-3 w-3" />
            hide
          </button>
        </div>
      </div>

      {panel === "chat" && (
        <ChatThread
          storyId={item.id}
          cityHint={item.city_id}
          onDraftCreated={() => setPanel("drafts")}
        />
      )}
      {panel === "drafts" && <DraftsPanel storyId={item.id} />}
    </article>
  );
}

function SignalColumn({ item }: { item: CockpitItem }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1" title={`${item.view_count} views`}>
        <Eye className="h-3 w-3" />
        {item.view_count}
      </span>
      <span className="inline-flex items-center gap-1" title={`${item.like_count} likes`}>
        <ThumbsUp className="h-3 w-3" />
        {item.like_count}
      </span>
      <span
        className={`inline-flex items-center gap-1 ${item.dislike_count > 0 ? "text-foreground" : ""}`}
        title={`${item.dislike_count} dislikes`}
      >
        <ThumbsDown className="h-3 w-3" />
        {item.dislike_count}
      </span>
      <span className="inline-flex items-center gap-1" title={`${item.share_count} shares`}>
        <Share2 className="h-3 w-3" />
        {item.share_count}
      </span>
      <span
        className={`inline-flex items-center gap-1 ${item.report_count > 0 ? "text-red-500" : ""}`}
        title={`${item.report_count} reports`}
      >
        <Flag className="h-3 w-3" />
        {item.report_count}
      </span>
    </div>
  );
}

// Phase 26: real chat thread. Loads history, sends to /chat, renders
// AI replies plus any applied-signal notes. Each story gets its own
// thread so context stays tight.
interface ConversationTurn {
  id: number;
  role: "admin" | "ai";
  message: string;
  extractedSignals?: Array<{
    kind: string;
    subject: string;
    target?: string | null;
    value?: string | null;
    confidence?: number;
  }>;
  createdAt: string;
}

function ChatThread({
  storyId,
  cityHint,
  onDraftCreated,
}: {
  storyId: number;
  cityHint: number | null;
  onDraftCreated?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastApplied, setLastApplied] = useState<string[]>([]);
  const { currentCity } = useAdminCity();

  const { data, refetch } = useQuery<{ turns: ConversationTurn[] }>({
    queryKey: ["story-conversation", storyId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/stories/${storyId}/conversation`);
      return res.json();
    },
  });

  async function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/admin/stories/${storyId}/chat`, {
        message: text,
        citySlug: currentCity.slug,
      });
      const body = await res.json();
      if (body?.error && !body?.aiTurn) {
        setError(String(body.error));
      } else if (body?.appliedNotes) {
        setLastApplied(body.appliedNotes);
      }
      setDraft("");
      await refetch();
      // Cockpit feed may have changed (desk reroute, hidden story).
      queryClient.invalidateQueries({ queryKey: ["cockpit-feed"] });
      queryClient.invalidateQueries({ queryKey: ["cockpit-summary"] });
      // If Gemini produced a new draft, refresh the drafts panel and pop it open.
      if (body?.newDraft) {
        queryClient.invalidateQueries({ queryKey: ["story-drafts", storyId] });
        onDraftCreated?.();
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setPending(false);
    }
  }

  const turns = data?.turns ?? [];

  return (
    <div className="mt-3 border-t border-border/50 pt-3 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <MessageSquare className="h-3 w-3" />
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em]">
          Train the AI about this story
        </span>
        {turns.length > 0 && (
          <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground/70">
            · {turns.length} message{turns.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {turns.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto rounded-md border border-card-border bg-secondary/20 p-2">
          {turns.map((t) => (
            <ChatTurn key={t.id} turn={t} />
          ))}
        </div>
      )}

      {lastApplied.length > 0 && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[0.7rem] text-emerald-600">
          {lastApplied.map((n, i) => (
            <div key={i}>✓ {n}</div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="e.g. 'this should be on the people desk - it's a profile about the new librarian, and Hamilton always cares about people stories'"
          rows={2}
          disabled={pending}
          className="flex-1 rounded-md border border-card-border bg-background px-2 py-1 text-xs disabled:opacity-50"
          data-testid={`chat-input-${storyId}`}
        />
        <button
          onClick={send}
          disabled={pending || !draft.trim()}
          className="shrink-0 rounded-md bg-foreground text-background px-3 py-1 text-xs hover-elevate disabled:opacity-50"
          data-testid={`chat-send-${storyId}`}
        >
          {pending ? "Sending..." : "Send"}
        </button>
      </div>
      {error && <div className="text-[0.7rem] text-red-500">{error}</div>}
      <p className="text-[0.65rem] text-muted-foreground/70">
        Cmd/Ctrl+Enter to send. Ask for changes ("tighten the headline",
        "too breathless, try again") and a new draft pops into the Drafts tab.
        Type "approved" or click Approve in Drafts to publish.
      </p>
    </div>
  );
}

function ChatTurn({ turn }: { turn: ConversationTurn }) {
  const isAdmin = turn.role === "admin";
  const sigs = Array.isArray(turn.extractedSignals) ? turn.extractedSignals : [];
  return (
    <div className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-md px-2 py-1 text-xs ${
          isAdmin
            ? "bg-foreground/10 text-foreground"
            : "bg-card border border-card-border text-foreground"
        }`}
      >
        <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">
          {isAdmin ? "you" : "ai"}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">{turn.message}</div>
        {sigs.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {sigs.map((s, i) => (
              <div
                key={i}
                className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[0.55rem] font-mono uppercase tracking-[0.14em] text-emerald-600 mr-1"
                title={`${s.kind} — ${s.subject}${s.value ? ` = ${s.value}` : ""}`}
              >
                {s.kind.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// Phase 27: drafts panel. Horizontal slider of versions. The most recent
// approved version is the "live" one; everything else is history.
interface StoryDraftRow {
  id: number;
  storyId: number;
  version: number;
  headline: string;
  summary: string | null;
  whyItMatters: string | null;
  desk: string | null;
  tags: string[] | null;
  sourceOfChange: string;
  conversationTurnId: number | null;
  status: "draft" | "approved" | "superseded";
  createdAt: string;
  approvedAt: string | null;
}

function DraftsPanel({ storyId }: { storyId: number }) {
  const { data, refetch } = useQuery<{ drafts: StoryDraftRow[] }>({
    queryKey: ["story-drafts", storyId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/stories/${storyId}/drafts`);
      return res.json();
    },
  });

  const drafts = data?.drafts ?? [];
  const [selected, setSelected] = useState<number | null>(null);

  // Default selection: latest draft, or latest approved if no draft pending.
  const effective = useMemo(() => {
    if (selected != null) return selected;
    if (drafts.length === 0) return null;
    const pending = [...drafts].reverse().find((d) => d.status === "draft");
    return (pending ?? drafts[drafts.length - 1]).version;
  }, [selected, drafts]);

  const approve = useMutation({
    mutationFn: async (version: number) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/stories/${storyId}/drafts/${version}/approve`,
      );
      return res.json();
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["cockpit-feed"] });
      queryClient.invalidateQueries({ queryKey: ["cockpit-summary"] });
    },
  });

  if (drafts.length === 0) {
    return (
      <div className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        No drafts yet. Open the chat tab and ask the AI for changes.
      </div>
    );
  }

  const current = drafts.find((d) => d.version === effective) ?? drafts[drafts.length - 1];
  const idx = drafts.findIndex((d) => d.version === current.version);
  const canPrev = idx > 0;
  const canNext = idx < drafts.length - 1;

  return (
    <div className="mt-3 border-t border-border/50 pt-3 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em]">
          Drafts
        </span>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground/70">
          {drafts.length} version{drafts.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* version slider */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        <button
          onClick={() => canPrev && setSelected(drafts[idx - 1].version)}
          disabled={!canPrev}
          className="shrink-0 rounded-md border border-card-border bg-card p-1 text-muted-foreground hover-elevate disabled:opacity-30"
          title="Previous version"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <div className="flex items-center gap-1 min-w-0">
          {drafts.map((d) => {
            const isCurrent = d.version === current.version;
            const tone =
              d.status === "approved"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : d.status === "draft"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                  : "border-card-border bg-card text-muted-foreground";
            return (
              <button
                key={d.version}
                onClick={() => setSelected(d.version)}
                className={`shrink-0 rounded-md border px-2 py-1 text-[0.65rem] font-mono uppercase tracking-[0.14em] transition-colors ${tone} ${
                  isCurrent ? "ring-1 ring-foreground/40" : ""
                }`}
                data-testid={`draft-chip-${storyId}-v${d.version}`}
                title={`${d.status} • ${absoluteDate(d.createdAt)}`}
              >
                v{d.version}
                {d.status === "approved" && " ✓"}
                {d.status === "draft" && " •"}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => canNext && setSelected(drafts[idx + 1].version)}
          disabled={!canNext}
          className="shrink-0 rounded-md border border-card-border bg-card p-1 text-muted-foreground hover-elevate disabled:opacity-30"
          title="Next version"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* selected version body */}
      <div className="rounded-md border border-card-border bg-secondary/20 p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground mb-1">
              v{current.version} •{" "}
              {current.status === "approved"
                ? "live"
                : current.status === "draft"
                  ? "proposed"
                  : "superseded"}{" "}
              • {current.sourceOfChange} • {absoluteDate(current.createdAt)}
            </div>
            <div className="text-sm font-semibold leading-snug">{current.headline}</div>
          </div>
          {current.status === "draft" && (
            <button
              onClick={() => approve.mutate(current.version)}
              disabled={approve.isPending}
              data-testid={`approve-draft-${storyId}-v${current.version}`}
              className="shrink-0 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover-elevate disabled:opacity-50"
              title="Publish this draft as the live story"
            >
              <Check className="h-3 w-3" />
              {approve.isPending ? "publishing..." : "approve & publish"}
            </button>
          )}
        </div>
        {current.summary && (
          <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {current.summary}
          </p>
        )}
        {current.whyItMatters && (
          <div className="rounded-md bg-card/60 border border-card-border/60 p-2">
            <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">
              Why it matters
            </div>
            <p className="text-xs text-foreground/85 leading-relaxed">{current.whyItMatters}</p>
          </div>
        )}
        {current.desk && (
          <div className="text-[0.65rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            desk: {current.desk}
          </div>
        )}
      </div>

      {approve.isError && (
        <div className="text-[0.7rem] text-red-500">
          Couldn't approve: {String((approve.error as any)?.message ?? approve.error)}
        </div>
      )}
    </div>
  );
}

// --- Settings drawer ---

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const sections: Array<{ label: string; href: string; desc: string }> = [
    { label: "Sources & feeds", href: "/admin/legacy?section=sources", desc: "Add or edit ingest sources; check feed health." },
    { label: "Auto-routing rules", href: "/admin/legacy?section=rules", desc: "Classification rules that route stories to desks." },
    { label: "Override patterns", href: "/admin/legacy?section=patterns", desc: "One-off headline rewrites and skip patterns." },
    { label: "Ingest log", href: "/admin/legacy?section=log", desc: "What the cron pulled in this hour." },
    { label: "History pool", href: "/admin/legacy?section=history", desc: "Curated long-form bank the daily writer pulls from." },
    { label: "Job posts", href: "/admin/legacy?section=jobs", desc: "Moderate community job submissions." },
    { label: "Editorial audits (raw)", href: "/admin/legacy?section=audits", desc: "Full audit log including dismissed/fixed." },
    { label: "Story Inbox (legacy)", href: "/admin/legacy?section=inbox", desc: "Old draft-review queue. Most of this is in the cockpit now." },
  ];

  return (
    <div className="fixed inset-0 z-40 bg-background/80" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="fixed right-0 top-0 bottom-0 w-full max-w-md border-l border-border bg-background shadow-xl overflow-y-auto"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-5 py-3">
          <h2 className="font-serif text-lg">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover-elevate text-muted-foreground"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            System internals. Most days you won't need to open this. The
            cockpit handles editorial decisions; this drawer handles the
            machinery underneath.
          </p>
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block rounded-md border border-card-border bg-card p-3 hover-elevate"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{s.label}</div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.desc}</div>
            </Link>
          ))}
          <div className="pt-4 border-t border-border">
            <Link
              href="/admin/legacy"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Open the full legacy admin
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
