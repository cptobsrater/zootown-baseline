/**
 * Phase 19: Editorial audit findings dashboard.
 *
 * Lists open findings written by the daily audit cron. Each row has a
 * one-click "Dismiss" (false positive) or "Fix" (acted on it) button.
 * Duplicate clusters get expanded into a side-by-side comparator so the
 * admin can pick a canonical row and hide the others in a single action.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

type AuditKind =
  | "duplicate"
  | "desk_misroute"
  | "event_integrity"
  | "proofreading"
  | "obit_dignity"
  | "crosspost_integrity"
  | "headline_length";

type Severity = "low" | "medium" | "high";
type Status = "open" | "dismissed" | "fixed";

interface AuditRow {
  id: number;
  kind: AuditKind;
  severity: Severity;
  status: Status;
  title: string;
  detail: string | null;
  subject_story_ids: number[];
  suggested_action: string | null;
  fingerprint: string;
  created_at: string;
  dismissed_at: string | null;
  fixed_at: string | null;
}

const KIND_LABEL: Record<AuditKind, string> = {
  duplicate: "Duplicate",
  desk_misroute: "Desk misroute",
  event_integrity: "Event integrity",
  proofreading: "Proofread",
  obit_dignity: "Obit dignity",
  crosspost_integrity: "Cross-post",
  headline_length: "Headline length",
};

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-200",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  low: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};

export function AuditsPanel() {
  const [kind, setKind] = useState<AuditKind | "all">("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<Status | "all">("open");

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  else params.set("status", "all");
  if (kind !== "all") params.set("kind", kind);
  params.set("limit", "300");

  const { data, isLoading, refetch } = useQuery<AuditRow[]>({
    queryKey: ["admin-audits", status, kind],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/audits?${params.toString()}`);
      return res.json();
    },
  });

  const runAudit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audits/run");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-audits"] });
    },
  });

  const filtered = (data ?? []).filter((r) => severity === "all" || r.severity === severity);

  // Count per kind for the top tiles.
  const counts: Record<AuditKind | "all", number> = {
    all: filtered.length,
    duplicate: 0, desk_misroute: 0, event_integrity: 0,
    proofreading: 0, obit_dignity: 0, crosspost_integrity: 0, headline_length: 0,
  };
  for (const r of filtered) counts[r.kind]++;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl">Editorial audits</h2>
        <button
          onClick={() => runAudit.mutate()}
          disabled={runAudit.isPending}
          data-testid="audit-run-now"
          className="flex items-center gap-2 rounded-md border border-card-border bg-card px-3 py-1.5 text-xs hover-elevate disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${runAudit.isPending ? "animate-spin" : ""}`} />
          {runAudit.isPending ? "Running..." : "Run audit now"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FilterGroup label="Status" value={status} onChange={setStatus as any} options={[
          ["open", "Open"], ["fixed", "Fixed"], ["dismissed", "Dismissed"], ["all", "All"],
        ]} />
        <FilterGroup label="Severity" value={severity} onChange={setSeverity as any} options={[
          ["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"],
        ]} />
        <FilterGroup label="Kind" value={kind} onChange={setKind as any} options={[
          ["all", `All (${counts.all})`],
          ...Object.entries(KIND_LABEL).map(([k, v]) => [k as AuditKind, `${v} (${counts[k as AuditKind]})`] as const),
        ]} />
      </div>

      {/* Findings list */}
      {isLoading && <div className="text-sm text-muted-foreground">Loading findings...</div>}
      {!isLoading && filtered.length === 0 && (
        <div className="rounded-md border border-card-border bg-card p-6 text-center text-sm text-muted-foreground">
          No findings match these filters. Quiet morning.
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((row) => (
          <FindingRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function FilterGroup<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</span>
      <div className="flex flex-wrap gap-1">
        {props.options.map(([v, label]) => (
          <button
            key={v}
            onClick={() => props.onChange(v)}
            data-testid={`audit-filter-${props.label.toLowerCase()}-${v}`}
            className={`rounded-md border px-2 py-1 transition-colors ${
              props.value === v
                ? "border-foreground/30 bg-secondary/60 text-foreground"
                : "border-card-border bg-card text-muted-foreground hover-elevate"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FindingRow({ row }: { row: AuditRow }) {
  const [expanded, setExpanded] = useState(false);

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/audits/${row.id}/dismiss`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-audits"] }),
  });
  const fix = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/audits/${row.id}/fix`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-audits"] }),
  });

  const isDuplicate = row.kind === "duplicate";

  return (
    <div className="rounded-md border border-card-border bg-card p-3" data-testid={`audit-row-${row.id}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex flex-1 items-start gap-2 text-left"
        >
          {isDuplicate || (row.subject_story_ids?.length ?? 0) > 1 ? (
            expanded ? <ChevronDown className="mt-1 h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="mt-1 h-3.5 w-3.5 text-muted-foreground" />
          ) : <span className="mt-1 inline-block h-3.5 w-3.5" />}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`inline-block rounded-md border px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] ${SEVERITY_STYLES[row.severity]}`}>
                {row.severity}
              </span>
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                {KIND_LABEL[row.kind]}
              </span>
              {row.status !== "open" && (
                <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground/70">· {row.status}</span>
              )}
            </div>
            <div className="mt-1 text-sm">{row.title}</div>
          </div>
        </button>
        {row.status === "open" && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending}
              data-testid={`audit-dismiss-${row.id}`}
              title="Dismiss (false positive)"
              className="rounded-md border border-card-border bg-card p-1.5 text-muted-foreground hover-elevate disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => fix.mutate()}
              disabled={fix.isPending}
              data-testid={`audit-fix-${row.id}`}
              title="Mark fixed (acted on it)"
              className="rounded-md border border-card-border bg-card p-1.5 text-green-300 hover-elevate disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-card-border pt-3 text-xs">
          {row.detail && (
            <pre className="whitespace-pre-wrap font-mono text-[0.65rem] leading-relaxed text-muted-foreground">{row.detail}</pre>
          )}
          {row.suggested_action && (
            <div className="text-muted-foreground">
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em]">Suggested action: </span>
              {row.suggested_action}
            </div>
          )}
          {isDuplicate && row.subject_story_ids.length >= 2 && (
            <DuplicateCluster auditId={row.id} storyIds={row.subject_story_ids} />
          )}
          {row.subject_story_ids.length === 1 && (
            <a
              href={`/api/admin/stories/${row.subject_story_ids[0]}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground hover:text-foreground"
            >
              View story #{row.subject_story_ids[0]} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

interface StoryStub {
  id: number;
  headline: string;
  source_name?: string;
  sourceName?: string;
  desk: string;
  published_at?: string;
  publishedAt?: string;
  mod_state?: string;
  modState?: string;
  source_url?: string;
  sourceUrl?: string;
}

function DuplicateCluster({ auditId, storyIds }: { auditId: number; storyIds: number[] }) {
  const { data: stories } = useQuery<StoryStub[]>({
    queryKey: ["audit-cluster", auditId, storyIds.join(",")],
    queryFn: async () => {
      // The admin stories endpoint accepts a comma-separated id list via ?ids=
      const res = await apiRequest("GET", `/api/admin/stories?ids=${storyIds.join(",")}`);
      const data = await res.json();
      return Array.isArray(data) ? data : data.items ?? [];
    },
  });

  const reject = useMutation({
    mutationFn: async (storyId: number) => {
      const res = await apiRequest("PATCH", `/api/admin/stories/${storyId}`, {
        modState: "rejected",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-audits"] });
      queryClient.invalidateQueries({ queryKey: ["audit-cluster"] });
    },
  });

  if (!stories) return <div className="text-muted-foreground">Loading cluster...</div>;
  const visible = stories.filter((s) => (s.mod_state ?? s.modState) !== "rejected");

  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground">
        Pick canonical · hide the rest
      </div>
      {visible.length === 0 && (
        <div className="text-xs text-muted-foreground">All duplicates in this cluster are already rejected.</div>
      )}
      {visible.map((s) => {
        const src = s.source_name ?? s.sourceName ?? "";
        const url = s.source_url ?? s.sourceUrl ?? "";
        return (
          <div key={s.id} className="flex items-start justify-between gap-2 rounded-md border border-card-border bg-secondary/30 p-2 text-xs">
            <div className="flex-1">
              <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground">#{s.id} · {src} · {s.desk}</div>
              <div className="mt-0.5 text-foreground">{s.headline}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open source URL"
                  className="rounded-md border border-card-border bg-card p-1.5 text-muted-foreground hover-elevate"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button
                onClick={() => reject.mutate(s.id)}
                disabled={reject.isPending}
                data-testid={`cluster-reject-${s.id}`}
                title="Reject this story (keep the others)"
                className="rounded-md border border-card-border bg-card p-1.5 text-red-300 hover-elevate disabled:opacity-50"
              >
                <XCircle className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
