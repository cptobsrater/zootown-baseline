import { useQuery } from "@tanstack/react-query";
import type { IngestRun } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { relativeTime } from "@/lib/format";
import { AlertTriangle } from "lucide-react";

export function IngestLogPanel() {
  const { data, isLoading } = useQuery<IngestRun[]>({
    queryKey: ["/api/ingest/runs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ingest/runs?limit=40");
      return (await res.json()) as IngestRun[];
    },
    refetchInterval: 10_000,
  });

  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
          Ingest log · latest 40 runs
        </div>
        <div className="text-xs text-muted-foreground">auto-refresh · 10s</div>
      </div>

      {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading runs…</div>}

      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="p-8 text-center">
          <p className="font-serif text-lg">No runs yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The scheduler will pick up due sources within a minute.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Mode</th>
              <th className="px-4 py-2 font-medium text-right">Fetched</th>
              <th className="px-4 py-2 font-medium text-right">Added</th>
              <th className="px-4 py-2 font-medium text-right">Dupes</th>
              <th className="px-4 py-2 font-medium text-right">Clustered</th>
              <th className="px-4 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  <div>{relativeTime(r.finishedAt)}</div>
                  <div className="text-[0.66rem] text-muted-foreground font-mono">
                    {new Date(r.finishedAt).toLocaleTimeString()}
                  </div>
                </td>
                <td className="px-4 py-2">{r.sourceName}</td>
                <td className="px-4 py-2">
                  <ModeChip mode={r.mode} />
                </td>
                <td className="px-4 py-2 text-right font-mono">{r.fetched}</td>
                <td className="px-4 py-2 text-right font-mono">
                  <span className={r.added > 0 ? "text-foreground font-semibold" : "text-muted-foreground"}>
                    {r.added}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">{r.duplicates}</td>
                <td className="px-4 py-2 text-right font-mono">
                  <span className={r.clustered > 0 ? "text-foreground font-semibold" : "text-muted-foreground"}>
                    {r.clustered}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {r.errors > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[0.66rem] text-destructive mr-2">
                      <AlertTriangle className="h-3 w-3" />
                      {r.errors} err
                    </span>
                  )}
                  {r.message && (
                    <span className="text-[0.72rem] text-muted-foreground">{r.message}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModeChip({ mode }: { mode: string }) {
  if (mode === "live") {
    return (
      <span className="inline-flex items-center rounded-full border border-[hsl(var(--desk-city))]/30 bg-[hsl(var(--desk-city))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-[hsl(var(--desk-city))]">
        LIVE
      </span>
    );
  }
  if (mode === "mock") {
    return (
      <span className="inline-flex items-center rounded-full border border-[hsl(var(--desk-business))]/30 bg-[hsl(var(--desk-business))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-[hsl(var(--desk-business))]">
        FIXTURES
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-muted-foreground">
      {mode.toUpperCase()}
    </span>
  );
}
