/**
 * /admin/rules-queue -- the AI-learning review surface.
 *
 * Two stacked tables:
 *   - Proposed (pending): things the scan thinks should become rules. Each
 *     row has Approve / Reject buttons and shows the evidence (hit count +
 *     contradictions + example story IDs).
 *   - Live: rules ingest currently consults. Each row shows lifetime hits
 *     and lets the admin soft-disable it.
 *
 * Above both, a toolbar with "Scan now" + window-days input. Scan runs the
 * pattern engine over story_deletions, fills proposed_rules, and auto-
 * promotes anything that crosses the high-confidence threshold.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminCityProvider } from "@/lib/admin-city-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import {
  ArrowLeft, ShieldAlert, Check, X, Power, Sparkles, Database,
} from "lucide-react";
import type { ProposedRule, LiveRule } from "@shared/schema";

interface QueueResponse {
  proposed: ProposedRule[];
  live: LiveRule[];
}

interface ScanResponse {
  scannedDeletions: number;
  buckets: number;
  proposed: number;
  autoPromoted: number;
  skipped: number;
  windowDays: number;
}

function RulesQueueInner() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [windowDays, setWindowDays] = useState(14);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResponse | null>(null);

  const q = useQuery<QueueResponse>({
    queryKey: ["/api/admin/rules-queue", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/rules-queue?status=${statusFilter}`);
      return res.json();
    },
  });

  async function scan() {
    setScanning(true);
    try {
      const res = await apiRequest("POST", "/api/admin/scan-rules", { windowDays });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ScanResponse;
      setLastScan(data);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/rules-queue"] });
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`Scan failed: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function review(id: number, action: "approve" | "reject") {
    const res = await apiRequest("POST", `/api/admin/rules-queue/${id}/review`, { action });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status}`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/rules-queue"] });
  }

  async function disableLive(id: number) {
    if (!confirm("Soft-disable this rule? It stays in the table for audit but stops affecting ingest.")) {
      return;
    }
    const res = await apiRequest("DELETE", `/api/admin/live-rules/${id}`);
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed: HTTP ${res.status}`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/rules-queue"] });
  }

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
            Learning rules queue
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Window
            <input
              type="number"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              min={1}
              max={90}
              className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm"
            />
            days
          </label>
          <button
            type="button"
            onClick={scan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-500 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {scanning ? "Scanning…" : "Scan for new rules"}
          </button>
          <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-destructive">
            <ShieldAlert className="h-3 w-3" />
            Internal
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4">
        {/* Scan summary */}
        {lastScan && (
          <div className="rounded-md border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-medium">Last scan</div>
            <div className="mt-1 text-xs">
              Scanned {lastScan.scannedDeletions} deletions in {lastScan.windowDays}d window across{" "}
              {lastScan.buckets} candidate buckets. Proposed {lastScan.proposed}, auto-promoted{" "}
              {lastScan.autoPromoted}, skipped {lastScan.skipped} (duplicate or below threshold).
            </div>
          </div>
        )}

        {/* Proposed rules */}
        <section>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Proposed rules</h2>
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
          </header>
          {q.isLoading ? (
            <div className="rounded-md border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !q.data?.proposed.length ? (
            <div className="rounded-md border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              <Database className="mx-auto mb-2 h-5 w-5 opacity-70" />
              {statusFilter === "pending"
                ? "No proposals waiting. Click 'Scan for new rules' to look at recent deletions."
                : "No proposals on record yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {q.data.proposed.map((r) => (
                <ProposedRow key={r.id} rule={r} onReview={review} />
              ))}
            </div>
          )}
        </section>

        {/* Live rules */}
        <section>
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live rules</h2>
            <span className="text-[0.65rem] text-muted-foreground">
              Ingest consults these to drop matching items.
            </span>
          </header>
          {!q.data?.live.length ? (
            <div className="rounded-md border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              No live rules yet. Approve a proposal above to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {q.data.live.map((r) => (
                <LiveRow key={r.id} rule={r} onDisable={disableLive} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ProposedRow({
  rule,
  onReview,
}: {
  rule: ProposedRule;
  onReview: (id: number, action: "approve" | "reject") => void;
}) {
  const isPending = rule.status === "pending";
  return (
    <div
      className={
        "rounded-md border bg-card/30 p-3 " +
        (isPending ? "border-amber-400/50" : "border-border/60 opacity-80")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
              {rule.matchType}
            </span>
            <span className="font-medium">{rule.matchValue}</span>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              →
            </span>
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[0.65rem] font-medium text-destructive">
              {rule.category}
            </span>
            {rule.status !== "pending" && (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                {rule.status}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {rule.hitCount} deletes / {rule.contradictionCount} contradictions /{" "}
            {rule.evidenceWindowDays}d window
            {rule.exampleStoryIds && rule.exampleStoryIds.length > 0 && (
              <>
                {" "}
                · Examples: {rule.exampleStoryIds.slice(0, 5).map((id) => `#${id}`).join(", ")}
              </>
            )}
          </div>
          {rule.reviewerNote && (
            <div className="mt-1 text-[0.65rem] italic text-muted-foreground">
              note: {rule.reviewerNote}
            </div>
          )}
        </div>
        {isPending && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onReview(rule.id, "approve")}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
            >
              <Check className="h-3 w-3" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReview(rule.id, "reject")}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveRow({
  rule,
  onDisable,
}: {
  rule: LiveRule;
  onDisable: (id: number) => void;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
              {rule.matchType}
            </span>
            <span className="font-medium">{rule.matchValue}</span>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              →
            </span>
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[0.65rem] font-medium text-destructive">
              {rule.category}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              {rule.source}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {rule.hitsLifetime} ingest hits lifetime
            {rule.lastHitAt && <> · last fired {new Date(rule.lastHitAt).toLocaleString()}</>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDisable(rule.id)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          title="Soft-disable this rule"
        >
          <Power className="h-3 w-3" />
          Disable
        </button>
      </div>
    </div>
  );
}

export default function RulesQueuePage() {
  return (
    <AdminCityProvider>
      <RulesQueueInner />
    </AdminCityProvider>
  );
}
