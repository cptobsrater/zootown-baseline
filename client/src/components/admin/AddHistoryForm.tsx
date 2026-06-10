import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Pencil, Trash2, Eye, EyeOff, X, Save } from "lucide-react";

interface HistoryStory {
  id: number;
  headline: string;
  summary: string;
  sourceUrl: string | null;
  desk?: "history" | "people";
  kind?: "history" | "profile" | "obituary";
  isVisible?: boolean;
  publishedAt: string;
  lastBumpedAt: string;
}

type DeskKind = "history" | "profile" | "obituary";

export function AddHistoryForm() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"history" | "people">("history");
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [deskKind, setDeskKind] = useState<DeskKind>("history");
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<HistoryStory>>({});

  const stories = useQuery<HistoryStory[]>({
    queryKey: ["/api/admin/history", activeTab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/history?desk=${activeTab}`);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const desk = deskKind === "history" ? "history" : "people";
      const res = await apiRequest("POST", "/api/admin/history", {
        headline, summary, sourceUrl: sourceUrl || undefined,
        desk, kind: deskKind,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      setHeadline(""); setSummary(""); setSourceUrl("");
      setMsg("Added.");
      qc.invalidateQueries({ queryKey: ["/api/admin/history"] });
      qc.invalidateQueries({ queryKey: ["/api/history"] });
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (err: any) => setMsg(`Error: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<HistoryStory> }) => {
      const res = await apiRequest("PATCH", `/api/admin/history/${id}`, patch);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft({});
      qc.invalidateQueries({ queryKey: ["/api/admin/history"] });
      qc.invalidateQueries({ queryKey: ["/api/history"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/history/${id}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/history"] });
      qc.invalidateQueries({ queryKey: ["/api/history"] });
    },
  });

  const rows = stories.data ?? [];
  const visibleCount = rows.filter((r) => r.isVisible !== false).length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center gap-4">
          <h2 className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            Long-form pool
          </h2>
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`px-3 py-1 rounded-sm ${activeTab === "history" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              History ({activeTab === "history" ? rows.length : "—"})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("people")}
              className={`px-3 py-1 rounded-sm ${activeTab === "people" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              People ({activeTab === "people" ? rows.length : "—"})
            </button>
          </div>
          <span className="ml-auto text-[0.7rem] text-muted-foreground">
            {visibleCount} of {rows.length} visible on site
          </span>
        </div>
        {stories.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!stories.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No {activeTab} articles yet. The daily writer will add one tomorrow, or use the form below to add one now.
          </div>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((s) => editingId === s.id ? (
              <li key={s.id} className="px-4 py-4 space-y-3 bg-secondary/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium">Headline</span>
                    <input
                      value={editDraft.headline ?? s.headline}
                      onChange={(e) => setEditDraft({ ...editDraft, headline: e.target.value })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium">Desk</span>
                    <select
                      value={editDraft.desk ?? s.desk ?? "history"}
                      onChange={(e) => setEditDraft({ ...editDraft, desk: e.target.value as any })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                    >
                      <option value="history">history</option>
                      <option value="people">people</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium">Kind</span>
                    <select
                      value={editDraft.kind ?? s.kind ?? "history"}
                      onChange={(e) => setEditDraft({ ...editDraft, kind: e.target.value as any })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                    >
                      <option value="history">history</option>
                      <option value="profile">profile</option>
                      <option value="obituary">obituary</option>
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium">Source URL (reference)</span>
                    <input
                      value={editDraft.sourceUrl ?? s.sourceUrl ?? ""}
                      onChange={(e) => setEditDraft({ ...editDraft, sourceUrl: e.target.value })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium">Body (markdown)</span>
                    <textarea
                      value={editDraft.summary ?? s.summary}
                      onChange={(e) => setEditDraft({ ...editDraft, summary: e.target.value })}
                      rows={10}
                      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateMutation.mutate({ id: s.id, patch: editDraft })}
                    disabled={updateMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2"
                  >
                    <Save className="h-3.5 w-3.5" />Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingId(null); setEditDraft({}); }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover-elevate"
                  >
                    <X className="h-3.5 w-3.5" />Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={s.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{s.headline}</span>
                    {s.kind && s.kind !== "history" && (
                      <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[0.6rem] font-mono uppercase text-muted-foreground">{s.kind}</span>
                    )}
                    {s.isVisible === false && (
                      <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[0.6rem] font-mono uppercase text-muted-foreground">hidden</span>
                    )}
                  </div>
                  <div className="mt-1 text-[0.72rem] text-muted-foreground font-mono">
                    Added {new Date(s.publishedAt).toLocaleDateString()}
                    {s.sourceUrl && (
                      <> · <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">reference</a></>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={s.isVisible === false ? "Show on site" : "Hide from site"}
                    onClick={() => updateMutation.mutate({ id: s.id, patch: { isVisible: s.isVisible === false } })}
                    className="rounded-md border border-input p-1.5 hover-elevate"
                  >
                    {s.isVisible === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => { setEditingId(s.id); setEditDraft({}); }}
                    className="rounded-md border border-input p-1.5 hover-elevate"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => { if (confirm(`Delete "${s.headline}"?`)) deleteMutation.mutate(s.id); }}
                    className="rounded-md border border-destructive/30 p-1.5 text-destructive hover-elevate"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-card-border bg-card p-4">
        <h2 className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground mb-4">
          Add new article
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Type *</label>
            <div className="flex flex-wrap gap-2">
              {([
                { id: "history" as const, label: "History (History desk)" },
                { id: "profile" as const, label: "Notable person profile (People desk)" },
                { id: "obituary" as const, label: "Obituary (People desk)" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDeskKind(opt.id)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    deskKind === opt.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover-elevate"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Headline *</label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. The Big Burn of 1910"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Body (Markdown) *</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Write the full story in markdown…"
              rows={10}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Reference URL (optional)</label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/wiki/…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {addMutation.isPending ? "Adding…" : "Add to pool"}
          </button>
          <p className="text-[0.72rem] text-muted-foreground">
            The daily writer adds 1 article per day, alternating between People and History. You can add articles manually anytime, and edit, hide, or delete any existing article above.
          </p>
        </div>
      </div>
    </div>
  );
}
