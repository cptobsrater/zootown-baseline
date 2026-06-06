import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface HistoryStory {
  id: number;
  headline: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string;
  lastBumpedAt: string;
}

export function AddHistoryForm() {
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: stories, isLoading } = useQuery<HistoryStory[]>({
    queryKey: ["/api/history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/history");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("admin_token") || sessionStorage.getItem("admin_token") || "";
      const res = await apiRequest("POST", "/api/admin/history", {
        headline,
        summary,
        sourceUrl: sourceUrl || undefined,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(JSON.stringify(err));
      }
      return res.json();
    },
    onSuccess: () => {
      setHeadline("");
      setSummary("");
      setSourceUrl("");
      setMsg("History story added successfully!");
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      setTimeout(() => setMsg(null), 3000);
    },
    onError: (err: any) => {
      setMsg(`Error: ${err.message}`);
    },
  });

  return (
    <div className="space-y-6">
      {/* Current pool */}
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            History Pool ({stories?.length ?? 0}/10)
          </h2>
        </div>
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {stories && stories.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No history stories yet.</div>
        )}
        {stories && stories.length > 0 && (
          <ul className="divide-y divide-border">
            {stories.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="font-medium text-sm text-foreground">{s.headline}</div>
                <div className="mt-1 text-[0.72rem] text-muted-foreground font-mono">
                  Bumped: {new Date(s.lastBumpedAt).toLocaleDateString()} ·{" "}
                  Added: {new Date(s.publishedAt).toLocaleDateString()}
                  {s.sourceUrl && (
                    <>
                      {" · "}
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        Source
                      </a>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      <div className="rounded-lg border border-card-border bg-card p-4">
        <h2 className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground mb-4">
          Add History Story
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Headline *</label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. The Big Burn of 1910"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
              data-testid="input-history-headline"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Body (Markdown) *
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Write the full story in markdown…"
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25 font-mono"
              data-testid="input-history-summary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Source URL (optional — Wikipedia or archive link)
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/wiki/…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
              data-testid="input-history-source-url"
            />
          </div>
          {msg && (
            <div className={`rounded-md px-3 py-2 text-sm ${msg.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
              {msg}
            </div>
          )}
          <button
            onClick={() => addMutation.mutate()}
            disabled={!headline.trim() || !summary.trim() || addMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 hover:opacity-90"
            data-testid="button-add-history"
          >
            {addMutation.isPending ? "Adding…" : "Add to Pool"}
          </button>
          <p className="text-[0.72rem] text-muted-foreground">
            Adding a new story bumps the oldest out if the pool exceeds 10.
          </p>
        </div>
      </div>
    </div>
  );
}
