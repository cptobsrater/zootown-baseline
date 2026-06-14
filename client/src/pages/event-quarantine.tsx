/**
 * /admin/event-quarantine
 *
 * Calendar items the ingester refused to publish because the start time
 * failed strict validation -- TBA wording, midnight fallback, past date,
 * unparseable, or simply absent. The reviewer can either:
 *
 *   - Release: type a corrected ISO start time (and optional desk
 *     override) and the item moves into the public calendar.
 *   - Reject: drop it permanently.
 *
 * Cody's standing instruction is the north star here: "if you can't get
 * solid confidence on the start time, don't post it as an event." This
 * page is the human-in-the-loop for that policy.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminCityProvider } from "@/lib/admin-city-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { ArrowLeft, ShieldAlert, Check, X, CalendarClock, Database, AlertTriangle } from "lucide-react";

interface QuarantinedEvent {
  id: number;
  sourceUrl: string;
  sourceName: string;
  headline: string;
  summary: string;
  venue: string | null;
  rawTimeText: string | null;
  candidateStartsAt: string | null;
  cityId: number | null;
  reason: string;
  status: "pending" | "released" | "rejected";
  reviewer: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  releasedStoryId: number | null;
  createdAt: string;
}

interface QListResponse {
  items: QuarantinedEvent[];
  counts: Record<"pending" | "released" | "rejected", number>;
}

const DESKS = ["city", "business", "crime", "sports", "health", "entertainment"] as const;

function EventQuarantineInner() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "released" | "rejected">("pending");

  const list = useQuery<QListResponse>({
    queryKey: ["/api/admin/event-quarantine", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/event-quarantine?status=${statusFilter}`);
      return res.json();
    },
  });

  async function review(
    id: number,
    action: "release" | "reject",
    extra?: { correctedStartsAt?: string; correctedDesk?: string; reviewerNote?: string },
  ) {
    const res = await apiRequest("POST", `/api/admin/event-quarantine/${id}/review`, {
      action,
      ...extra,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status} ${body}`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/event-quarantine"] });
  }

  const counts = list.data?.counts ?? { pending: 0, released: 0, rejected: 0 };

  return (
    <div className="min-h-screen bg-background">
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
            Event quarantine
          </span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-destructive">
          <ShieldAlert className="h-3 w-3" />
          Internal
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4">
        <section className="rounded-md border border-border/60 bg-card/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-amber-500" />
            <h2 className="text-lg font-semibold">Held back from the calendar</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            These calendar items had unclear or missing start times. Until a person confirms a time,
            they stay out of the public calendar.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Pending" value={counts.pending} />
            <Stat label="Released" value={counts.released} />
            <Stat label="Rejected" value={counts.rejected} />
          </div>
        </section>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Items</h2>
          <div className="flex items-center gap-1">
            {(["pending", "released", "rejected"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={
                  "rounded-md border px-2 py-0.5 text-[0.65rem] font-mono uppercase tracking-[0.16em] " +
                  (statusFilter === s
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground")
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {list.isLoading ? (
          <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : !list.data?.items.length ? (
          <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
            <Database className="mx-auto mb-2 h-5 w-5 opacity-70" />
            {statusFilter === "pending"
              ? "Nothing waiting. Calendar items with confident start times are publishing automatically."
              : "Nothing on record."}
          </div>
        ) : (
          <div className="space-y-4">
            {list.data.items.map((e) => (
              <QuarantineCard key={e.id} ev={e} onReview={review} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function formatReason(reason: string): string {
  if (reason.startsWith("ambiguous_wording")) return "Ambiguous wording (TBD, see website, etc.)";
  if (reason === "no_time") return "No start time in source";
  if (reason === "unparseable_time") return "Could not parse the start time";
  if (reason === "past_date") return "Start time is in the past";
  if (reason === "midnight_fallback") return "Suspicious midnight time (likely parser fallback)";
  return reason;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  // datetime-local expects YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function QuarantineCard({
  ev,
  onReview,
}: {
  ev: QuarantinedEvent;
  onReview: (
    id: number,
    action: "release" | "reject",
    extra?: { correctedStartsAt?: string; correctedDesk?: string; reviewerNote?: string },
  ) => Promise<void>;
}) {
  const [correctedAt, setCorrectedAt] = useState<string>(toDatetimeLocalValue(ev.candidateStartsAt));
  const [desk, setDesk] = useState<string>("entertainment");
  const [busy, setBusy] = useState(false);

  const readOnly = ev.status !== "pending";

  async function release() {
    if (!correctedAt) {
      // eslint-disable-next-line no-alert
      alert("Pick a corrected start time before releasing.");
      return;
    }
    setBusy(true);
    try {
      // datetime-local is local timezone; convert to ISO before sending.
      const iso = new Date(correctedAt).toISOString();
      await onReview(ev.id, "release", { correctedStartsAt: iso, correctedDesk: desk });
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await onReview(ev.id, "reject");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-md border border-border/60 bg-card/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          {formatReason(ev.reason)}
        </span>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
          {ev.sourceName}
        </span>
        {ev.venue ? (
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
            · {ev.venue}
          </span>
        ) : null}
      </div>

      <h3 className="text-base font-semibold leading-snug">{ev.headline}</h3>
      {ev.summary ? (
        <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{ev.summary}</p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
            Candidate time (parsed)
          </label>
          <div className="font-mono text-xs">
            {ev.candidateStartsAt ? new Date(ev.candidateStartsAt).toLocaleString() : "(none)"}
          </div>
        </div>
        <div>
          <label className="block font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
            Source
          </label>
          <a
            href={ev.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
          >
            {ev.sourceUrl}
          </a>
        </div>
      </div>

      {!readOnly && (
        <div className="mt-3 grid gap-3 rounded-md border border-border/40 bg-background/40 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <div>
            <label className="block font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
              Corrected start
            </label>
            <input
              type="datetime-local"
              value={correctedAt}
              onChange={(e) => setCorrectedAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
              Desk
            </label>
            <select
              value={desk}
              onChange={(e) => setDesk(e.target.value)}
              className="mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {DESKS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={release}
            className="self-end inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 hover-elevate disabled:opacity-50 dark:text-emerald-300"
          >
            <Check className="h-3 w-3" />
            Release
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="self-end inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover-elevate disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            Reject
          </button>
        </div>
      )}

      {readOnly && (
        <div className="mt-3 rounded-md border border-border/40 bg-background/40 p-2 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-[0.16em]">{ev.status}</span>
          {ev.reviewedAt ? ` · ${new Date(ev.reviewedAt).toLocaleString()}` : null}
          {ev.reviewer ? ` · by ${ev.reviewer}` : null}
          {ev.releasedStoryId ? ` · story #${ev.releasedStoryId}` : null}
        </div>
      )}
    </article>
  );
}

export default function EventQuarantinePage() {
  return (
    <AdminCityProvider>
      <EventQuarantineInner />
    </AdminCityProvider>
  );
}
