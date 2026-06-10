import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Source } from "@shared/schema";

type SourceWithCount = Source & { publishedCount: number };
import { apiRequest, queryClient } from "@/lib/queryClient";
import { relativeTime } from "@/lib/format";
import { AddSourceForm } from "@/components/admin/AddSourceForm";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { EditSourceModal } from "@/components/admin/EditSourceModal";
import {
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Radio,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Trash2,
  Pencil,
} from "lucide-react";

export function SourcesPanel() {
  const { data: sources, isLoading } = useQuery<SourceWithCount[]>({
    queryKey: ["/api/sources"],
    refetchInterval: 15_000,
  });

  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<SourceWithCount | null>(null);
  const [editing, setEditing] = useState<SourceWithCount | null>(null);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/sources/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      setDeleting(null);
    },
  });

  const runOne = useMutation({
    mutationFn: async (sourceId: number) => {
      setBusyId(sourceId);
      const res = await apiRequest("POST", `/api/ingest/run/${sourceId}`);
      return res.json();
    },
    onSettled: () => {
      setBusyId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingest/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pulse"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trending-tags"] });
    },
  });

  const runAll = useMutation({
    mutationFn: async () => {
      setBusyAll(true);
      const res = await apiRequest("POST", "/api/ingest/run");
      return res.json();
    },
    onSettled: () => {
      setBusyAll(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingest/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pulse"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trending-tags"] });
    },
  });

  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            Watched sources
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {sources?.length ?? 0} configured · polled every 5–60 min
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            data-testid="button-add-source"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Add source
          </button>
          <button
            onClick={() => runAll.mutate()}
            disabled={busyAll}
            data-testid="button-refresh-all"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate active-elevate-2 disabled:opacity-60"
          >
            {busyAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh all
          </button>
        </div>
      </div>

      {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading sources…</div>}

      <ul className="divide-y divide-border">
        {(sources ?? []).map((s) => (
          <li key={s.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot status={s.lastStatus} />
                <span className="font-serif text-[1rem] font-semibold text-foreground">{s.name}</span>
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
                  {s.sourceType}
                </span>
                <FeedBadge feedType={s.feedType} mode={s.lastMode} />
                <PublishedBadge count={s.publishedCount ?? 0} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-muted-foreground">
                <span className="truncate max-w-[360px]">{s.feedUrl ?? s.url}</span>
                <span>·</span>
                <span>every {s.cadenceMinutes} min</span>
                <span>·</span>
                <span>
                  {s.lastCheckedAt ? `last check ${relativeTime(s.lastCheckedAt)}` : "not yet checked"}
                </span>
                {typeof s.lastItems === "number" && s.lastItems > 0 && (
                  <>
                    <span>·</span>
                    <span>+{s.lastItems} on last run</span>
                  </>
                )}
              </div>
              {s.lastError && (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/8 px-2 py-0.5 text-[0.68rem] text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {s.lastError}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => runOne.mutate(s.id)}
                disabled={busyId === s.id}
                data-testid={`button-run-source-${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate active-elevate-2 disabled:opacity-60"
              >
                {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run now
              </button>
              <button
                onClick={() => setEditing(s)}
                data-testid={`button-edit-source-${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover-elevate active-elevate-2"
                title="Edit source"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeleting(s)}
                data-testid={`button-delete-source-${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs font-medium text-destructive hover-elevate active-elevate-2"
                title="Delete source"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {showAdd && <AddSourceForm onClose={() => setShowAdd(false)} />}
      {editing && <EditSourceModal source={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body={`This source will be removed from the rotation. ${deleting.publishedCount > 0 ? `${deleting.publishedCount} published article(s) from this source will remain.` : ""}`}
          confirmLabel="Delete source"
          destructive
          busy={deleteMut.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMut.mutate(deleting.id)}
          testIdConfirm="button-confirm-delete-source"
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full"
        title="Last run succeeded"
      >
        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--desk-entertainment))]" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full"
        title="Last run errored"
      >
        <AlertTriangle className="h-4 w-4 text-destructive" />
      </span>
    );
  }
  if (status === "stale") {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full"
        title="Last run returned no new items"
      >
        <Radio className="h-4 w-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full"
      title="Never checked"
    >
      <CircleDashed className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

function PublishedBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-destructive"
        title="No articles ever published from this source — consider removing"
        data-testid="badge-published-zero"
      >
        0 PUBLISHED
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-muted-foreground"
      title={`${count} approved article${count === 1 ? "" : "s"} published from this source`}
      data-testid="badge-published-count"
    >
      {count} PUBLISHED
    </span>
  );
}

function FeedBadge({ feedType, mode }: { feedType: string; mode: string | null }) {
  if (mode === "mock") {
    return (
      <span
        className="inline-flex items-center rounded-full border border-[hsl(var(--desk-business))]/30 bg-[hsl(var(--desk-business))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-[hsl(var(--desk-business))]"
        title="Live fetch failed — showing fixtures"
      >
        FIXTURES
      </span>
    );
  }
  if (mode === "live") {
    return (
      <span className="inline-flex items-center rounded-full border border-[hsl(var(--desk-city))]/30 bg-[hsl(var(--desk-city))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-[hsl(var(--desk-city))]">
        LIVE · {feedType.toUpperCase()}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-muted-foreground">
      {feedType.toUpperCase()}
    </span>
  );
}
