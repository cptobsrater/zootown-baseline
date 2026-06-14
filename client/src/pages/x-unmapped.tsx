/**
 * /admin/x-unmapped -- the X authors triage page.
 *
 * Each row is a Twitter account that the ingest pipeline has seen at least
 * once but hasn't been classified yet. Three actions per row:
 *
 *   Assign to a city (Missoula/Billings/etc, or 'statewide' = NULL city)
 *   Mute (block this author from ever ingesting again)
 *   Skip (leave it in the queue, decide later)
 *
 * Stats card at the top shows monthly quota usage so the admin knows how
 * many tweets the system has consumed against the 10k/month Basic-tier cap.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminCityProvider, useAdminCity } from "@/lib/admin-city-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { ArrowLeft, ShieldAlert, Check, X, Database, ExternalLink } from "lucide-react";

interface UnmappedAuthor {
  authorId: string;
  username: string;
  displayName: string;
  lastTweetId: string | null;
  lastTweetText: string | null;
  seenCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface XStats {
  cursor: {
    listId: string;
    lastTweetId: string | null;
    tweetsThisMonth: number;
    monthStartedAt: string;
    lastPolledAt: string | null;
    lastError: string | null;
  } | null;
  counts: {
    tweetsTotal: number;
    authorsTotal: number;
    unmappedTotal: number;
  };
}

function XUnmappedInner() {
  const { cities } = useAdminCity();

  const queue = useQuery<{ items: UnmappedAuthor[] }>({
    queryKey: ["/api/admin/x-unmapped"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/x-unmapped");
      return res.json();
    },
  });

  const stats = useQuery<XStats>({
    queryKey: ["/api/admin/x-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/x-stats");
      return res.json();
    },
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/x-unmapped"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/x-stats"] }),
    ]);
  }

  async function assign(authorId: string, cityId: number | null) {
    const res = await apiRequest("POST", `/api/admin/x-unmapped/${authorId}/assign`, {
      cityId,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status}`);
      return;
    }
    await refresh();
  }

  async function mute(authorId: string) {
    if (!confirm("Mute this author? They'll be ignored on all future polls.")) return;
    const res = await apiRequest("POST", `/api/admin/x-unmapped/${authorId}/mute`);
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status}`);
      return;
    }
    await refresh();
  }

  const s = stats.data;
  const cap = 10000;
  const used = s?.cursor?.tweetsThisMonth ?? 0;
  const pct = Math.min(100, Math.round((used / cap) * 100));

  return (
    <div className="min-h-screen bg-background">
      {/* Toolbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover-elevate"
          >
            <ArrowLeft className="h-3 w-3" />
            Admin
          </Link>
          <Link href="/" aria-label="ZooTown home">
            <Wordmark />
          </Link>
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
            X authors queue
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-destructive">
            <ShieldAlert className="h-3 w-3" />
            Internal
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4">
        {/* Stats card */}
        <section className="rounded-md border border-border/60 bg-card/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">X API usage</h2>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Basic tier · 10,000 tweets/month
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Tweets this month" value={used} sub={`${pct}% of cap`} />
            <Stat label="Tweets in DB" value={s?.counts.tweetsTotal ?? 0} />
            <Stat label="Mapped authors" value={s?.counts.authorsTotal ?? 0} />
            <Stat label="Unmapped queue" value={s?.counts.unmappedTotal ?? 0} />
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-amber-400"
              style={{ width: `${pct}%` }}
            />
          </div>
          {s?.cursor?.lastPolledAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last poll: {new Date(s.cursor.lastPolledAt).toLocaleString()}
            </p>
          )}
          {s?.cursor?.lastError && (
            <p className="mt-1 text-xs text-destructive">
              Last error: {s.cursor.lastError}
            </p>
          )}
        </section>

        {/* Queue */}
        <section>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Unmapped authors</h2>
            <span className="text-[0.65rem] text-muted-foreground">
              Pick a city per row, or mute to ignore forever.
            </span>
          </header>
          {queue.isLoading ? (
            <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !queue.data?.items.length ? (
            <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
              <Database className="mx-auto mb-2 h-5 w-5 opacity-70" />
              Queue is empty. Nice. New unfamiliar authors will appear here as
              they post.
            </div>
          ) : (
            <div className="space-y-2">
              {queue.data.items.map((a) => (
                <UnmappedRow
                  key={a.authorId}
                  author={a}
                  cities={cities}
                  onAssign={assign}
                  onMute={mute}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {sub && <div className="text-[0.65rem] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function UnmappedRow({
  author,
  cities,
  onAssign,
  onMute,
}: {
  author: UnmappedAuthor;
  cities: { id: number; slug: string; displayName: string }[];
  onAssign: (authorId: string, cityId: number | null) => void;
  onMute: (authorId: string) => void;
}) {
  const [picked, setPicked] = useState<string>("");

  function submit() {
    if (picked === "") return;
    const cityId = picked === "statewide" ? null : Number(picked);
    onAssign(author.authorId, cityId);
  }

  return (
    <div className="rounded-md border border-amber-400/40 bg-amber-50/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">@</span>
            <a
              href={`https://x.com/${author.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold hover:underline"
            >
              {author.username}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
            <span className="text-muted-foreground">·</span>
            <span>{author.displayName}</span>
            <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[0.65rem] font-medium text-amber-900">
              {author.seenCount} tweet{author.seenCount === 1 ? "" : "s"}
            </span>
          </div>
          {author.lastTweetText && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {author.lastTweetText}
            </p>
          )}
          <p className="mt-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
            First seen {new Date(author.firstSeen).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">Pick a city…</option>
            <option value="statewide">Statewide / all cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={picked === ""}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <Check className="h-3 w-3" />
            Assign
          </button>
          <button
            type="button"
            onClick={() => onMute(author.authorId)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Mute
          </button>
        </div>
      </div>
    </div>
  );
}

export default function XUnmappedPage() {
  return (
    <AdminCityProvider>
      <XUnmappedInner />
    </AdminCityProvider>
  );
}
