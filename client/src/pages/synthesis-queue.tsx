/**
 * /admin/synthesis-queue
 *
 * Reviews Gemini-written synthesis drafts that scored "review" (not safe
 * enough to auto-publish, not bad enough to suppress). Each row shows:
 *   - The cluster's four scores
 *   - The draft headline + body
 *   - An optional inline edit (headline + body textareas) before Approve
 *   - Approve / Reject buttons
 *
 * Approve publishes the draft as a story tagged is_synthesis=true and
 * marks the cluster done. Reject flips the cluster to verdict=suppress.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminCityProvider } from "@/lib/admin-city-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { ArrowLeft, ShieldAlert, Check, X, Database, Sparkles } from "lucide-react";

interface SynthesisDraft {
  id: number;
  clusterId: number;
  headline: string;
  body: string;
  desk: string;
  cityId: number | null;
  model: string;
  sourceStoryIds: number[];
  status: "pending" | "approved" | "rejected" | "published";
  reviewer: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  clusterDiversity: string | null;
  clusterMontana: string | null;
  clusterPolitics: string | null;
  clusterAuthors: number | null;
  createdAt: string;
}

interface SynthStats {
  clustersByVerdict: { verdict: string; count: number }[];
  pendingReview: number;
  publishedTotal: number;
}

function SynthesisQueueInner() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");

  const queue = useQuery<{ items: SynthesisDraft[] }>({
    queryKey: ["/api/admin/synthesis-queue", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/synthesis-queue?status=${statusFilter}`);
      return res.json();
    },
  });

  const stats = useQuery<SynthStats>({
    queryKey: ["/api/admin/synthesis-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/synthesis-stats");
      return res.json();
    },
  });

  async function review(
    id: number,
    action: "approve" | "reject",
    overrides?: { headline?: string; body?: string },
  ) {
    const res = await apiRequest("POST", `/api/admin/synthesis-queue/${id}/review`, {
      action,
      ...overrides,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status}`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/synthesis-queue"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/synthesis-stats"] });
  }

  const s = stats.data;

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
            Synthesis queue
          </span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-destructive">
          <ShieldAlert className="h-3 w-3" />
          Internal
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4">
        {/* Stats */}
        <section className="rounded-md border border-border/60 bg-card/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="text-lg font-semibold">Synthesis pipeline</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Pending review" value={s?.pendingReview ?? 0} />
            <Stat label="Published total" value={s?.publishedTotal ?? 0} />
            {s?.clustersByVerdict.map((v) => (
              <Stat
                key={v.verdict}
                label={`Clusters: ${v.verdict.replace("_", " ")}`}
                value={v.count}
              />
            ))}
          </div>
        </section>

        {/* Filter */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Drafts</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatusFilter("pending")}
              className={
                "rounded-md border px-2 py-0.5 text-[0.65rem] font-mono uppercase tracking-[0.16em] " +
                (statusFilter === "pending"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground")
              }
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={
                "rounded-md border px-2 py-0.5 text-[0.65rem] font-mono uppercase tracking-[0.16em] " +
                (statusFilter === "all"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground")
              }
            >
              All
            </button>
          </div>
        </div>

        {queue.isLoading ? (
          <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : !queue.data?.items.length ? (
          <div className="rounded-md border border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
            <Database className="mx-auto mb-2 h-5 w-5 opacity-70" />
            {statusFilter === "pending"
              ? "No drafts waiting. Multi-source clusters will appear here as the system writes them."
              : "Nothing on record yet."}
          </div>
        ) : (
          <div className="space-y-4">
            {queue.data.items.map((d) => (
              <DraftCard key={d.id} draft={d} onReview={review} />
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

function DraftCard({
  draft,
  onReview,
}: {
  draft: SynthesisDraft;
  onReview: (
    id: number,
    action: "approve" | "reject",
    overrides?: { headline?: string; body?: string },
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(draft.headline);
  const [body, setBody] = useState(draft.body);
  const isPending = draft.status === "pending";

  return (
    <div
      className={
        "rounded-md border bg-card/30 p-4 " +
        (isPending ? "border-amber-400/50" : "border-border/60 opacity-80")
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.65rem]">
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 font-mono uppercase tracking-[0.14em] text-muted-foreground">
          {draft.desk}
        </span>
        <span className="text-muted-foreground">
          cluster #{draft.clusterId} · {draft.sourceStoryIds.length} sources · {draft.clusterAuthors}{" "}
          authors
        </span>
        {draft.clusterDiversity && (
          <span className="text-muted-foreground">
            diversity {draft.clusterDiversity} · montana {draft.clusterMontana} · politics{" "}
            {draft.clusterPolitics}
          </span>
        )}
        {draft.status !== "pending" && (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono uppercase tracking-[0.16em]">
            {draft.status}
          </span>
        )}
      </div>

      {editing && isPending ? (
        <>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-lg font-semibold"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </>
      ) : (
        <>
          <h3 className="mb-2 text-lg font-semibold">{draft.headline}</h3>
          <p className="text-sm text-muted-foreground">{draft.body}</p>
        </>
      )}

      {draft.reviewerNote && (
        <p className="mt-2 text-[0.65rem] italic text-muted-foreground">
          reviewer note: {draft.reviewerNote}
        </p>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setHeadline(draft.headline);
                setBody(draft.body);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel edit
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Edit before approve
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              onReview(draft.id, "approve", editing ? { headline, body } : undefined)
            }
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
          >
            <Check className="h-3 w-3" />
            Approve & publish
          </button>
          <button
            type="button"
            onClick={() => onReview(draft.id, "reject")}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export default function SynthesisQueuePage() {
  return (
    <AdminCityProvider>
      <SynthesisQueueInner />
    </AdminCityProvider>
  );
}
