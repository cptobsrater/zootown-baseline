import { useQuery } from "@tanstack/react-query";
import type { StoryEdit } from "@shared/schema";
import { relativeTime } from "@/lib/format";
import { History, TrendingUp } from "lucide-react";

interface Pattern {
  sourceName: string;
  field: string;
  count: number;
}

interface EditsResponse {
  edits: StoryEdit[];
  patterns: Pattern[];
}

export function EditPatternsPanel() {
  const { data, isLoading } = useQuery<EditsResponse>({
    queryKey: ["/api/admin/edits"],
    refetchInterval: 30_000,
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            Override patterns (last 7 days)
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="mb-3 text-[0.7rem] text-muted-foreground">
            Recent manual overrides — these patterns inform parser fixes (not ML training).
          </p>
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && (data?.patterns?.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">No overrides yet.</p>
          )}
          <ul className="space-y-1.5">
            {(data?.patterns ?? []).map((p, i) => (
              <li
                key={`${p.sourceName}-${p.field}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
                data-testid={`pattern-${i}`}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-serif text-sm font-medium">{p.sourceName}</span>
                  <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {p.field}
                  </span>
                </div>
                <span className="font-mono text-xs text-foreground">{p.count}×</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            Recent edits
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {isLoading && <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && (data?.edits?.length ?? 0) === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground">No edits logged yet.</p>
          )}
          <ul className="divide-y divide-border">
            {(data?.edits ?? []).map((e) => (
              <li key={e.id} className="px-4 py-2.5" data-testid={`edit-${e.id}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {e.field}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    story #{e.storyId} · {relativeTime(e.editedAt)}
                  </span>
                </div>
                {e.field !== "deleted" && (
                  <div className="mt-1 grid grid-cols-1 gap-0.5 text-xs">
                    <div className="text-muted-foreground line-through line-clamp-1">
                      {e.beforeValue ?? "—"}
                    </div>
                    <div className="text-foreground line-clamp-1">{e.afterValue ?? "—"}</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
