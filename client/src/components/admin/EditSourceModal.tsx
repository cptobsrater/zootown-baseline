import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Save, X } from "lucide-react";
import type { Source } from "@shared/schema";

const DESKS = ["city", "business", "crime", "sports", "health", "entertainment", "people", "history"];
const FEED_TYPES = ["rss", "atom", "html", "headless", "none"] as const;
const CATEGORIES = ["official", "news", "calendars", "social"] as const;

interface Props {
  source: Source & { publishedCount?: number; trustScore?: number };
  onClose: () => void;
}

export function EditSourceModal({ source, onClose }: Props) {
  const qc = useQueryClient();
  const desks: string[] = (() => { try { return JSON.parse(source.desks as unknown as string); } catch { return []; } })();

  const [draft, setDraft] = useState({
    name: source.name, url: source.url, feedUrl: source.feedUrl ?? "",
    feedType: source.feedType, parserKey: source.parserKey ?? "", sourceType: source.sourceType,
    desks: desks as string[], cadenceMinutes: source.cadenceMinutes,
    active: source.active, category: source.category, trustScore: (source as any).trustScore ?? 50,
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: draft.name, url: draft.url, feedUrl: draft.feedUrl || null,
        feedType: draft.feedType, parserKey: draft.parserKey || null,
        sourceType: draft.sourceType, desks: draft.desks,
        cadenceMinutes: Number(draft.cadenceMinutes), active: draft.active,
        category: draft.category, trustScore: Number(draft.trustScore),
      };
      const res = await apiRequest("PATCH", `/api/admin/sources/${source.id}`, body);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/sources"] }); onClose(); },
  });

  const toggleDesk = (d: string) => setDraft((s) => ({ ...s, desks: s.desks.includes(d) ? s.desks.filter((x) => x !== d) : [...s.desks, d] }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg border border-card-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-card-border px-5 py-3">
          <h2 className="font-serif text-lg font-semibold text-foreground">Edit source</h2>
          <button onClick={onClose} className="rounded-md p-1 hover-elevate"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-foreground">Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Homepage URL</span><input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Feed URL</span><input value={draft.feedUrl} onChange={(e) => setDraft({ ...draft, feedUrl: e.target.value })} placeholder="optional" className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Feed type</span>
              <select value={draft.feedType} onChange={(e) => setDraft({ ...draft, feedType: e.target.value as Source["feedType"] })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
                {FEED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-medium text-foreground">Parser key</span><input value={draft.parserKey} onChange={(e) => setDraft({ ...draft, parserKey: e.target.value })} placeholder="optional" className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Source type</span><input value={draft.sourceType} onChange={(e) => setDraft({ ...draft, sourceType: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Category</span>
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Source["category"] })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-medium text-foreground">Cadence (min)</span><input type="number" min={1} max={10080} value={draft.cadenceMinutes} onChange={(e) => setDraft({ ...draft, cadenceMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-foreground">Trust score (0–100)</span><input type="number" min={0} max={100} value={draft.trustScore} onChange={(e) => setDraft({ ...draft, trustScore: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" /></label>
          </div>
          <div>
            <span className="text-xs font-medium text-foreground">Desks</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DESKS.map((d) => (
                <button key={d} type="button" onClick={() => toggleDesk(d)} className={`rounded-md border px-2 py-1 text-[0.72rem] ${draft.desks.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover-elevate"}`}>{d}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4 rounded border-input" />
            <span>Active</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-card-border bg-secondary/30 px-5 py-3">
          {save.isError && <span className="mr-auto text-xs text-destructive">Save failed — check URL fields</span>}
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover-elevate">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />{save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
