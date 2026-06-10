import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Trash2, Plus, Pencil, Save, X } from "lucide-react";

interface Rule {
  id: number;
  matchField: "headline" | "summary" | "text" | "source";
  pattern: string;
  action: "set_desk" | "reject" | "set_kind";
  value: string;
  priority: number;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  hitCount: number;
  active: boolean;
}

const FIELD_LABELS: Record<Rule["matchField"], string> = {
  text: "Headline + summary",
  headline: "Headline only",
  summary: "Summary only",
  source: "Source name / URL",
};
const ACTION_LABELS: Record<Rule["action"], string> = {
  set_desk: "Route to desk",
  reject: "Reject the story",
  set_kind: "Set kind",
};
const DESKS = ["city", "business", "crime", "sports", "health", "events", "people", "history"];

export function RulesPanel() {
  const qc = useQueryClient();
  const rulesQuery = useQuery<{ rules: Rule[] }>({
    queryKey: ["/api/admin/rules"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/rules");
      return res.json();
    },
  });

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Partial<Rule>>({});

  const startNew = () => {
    setEditingId("new");
    setDraft({ matchField: "text", pattern: "", action: "set_desk", value: "people", priority: 50, notes: "", active: true });
  };
  const startEdit = (r: Rule) => { setEditingId(r.id); setDraft({ ...r }); };
  const cancel = () => { setEditingId(null); setDraft({}); };

  const save = useMutation({
    mutationFn: async () => {
      if (editingId === "new") {
        const res = await apiRequest("POST", "/api/admin/rules", draft);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }
      const res = await apiRequest("PATCH", `/api/admin/rules/${editingId}`, draft);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/rules"] }); cancel(); },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/rules/${id}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/rules"] }),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: Rule) => {
      const res = await apiRequest("PATCH", `/api/admin/rules/${r.id}`, { active: !r.active });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/rules"] }),
  });

  const rules = rulesQuery.data?.rules ?? [];

  const ruleForm = (
    <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-foreground">Match against</span>
          <select value={draft.matchField ?? "text"} onChange={(e) => setDraft({ ...draft, matchField: e.target.value as Rule["matchField"] })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
            {(Object.keys(FIELD_LABELS) as Rule["matchField"][]).map((k) => <option key={k} value={k}>{FIELD_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-foreground">Pattern (substring, or /regex/)</span>
          <input type="text" value={draft.pattern ?? ""} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} placeholder='e.g. obituary  or  /memori(al|am)/' className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-foreground">Then…</span>
          <select value={draft.action ?? "set_desk"} onChange={(e) => setDraft({ ...draft, action: e.target.value as Rule["action"] })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
            {(Object.keys(ACTION_LABELS) as Rule["action"][]).map((k) => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-foreground">Value</span>
          {draft.action === "set_desk" ? (
            <select value={draft.value ?? "people"} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
              {DESKS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : draft.action === "set_kind" ? (
            <select value={draft.value ?? "obituary"} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm">
              <option value="history">history</option>
              <option value="profile">profile</option>
              <option value="obituary">obituary</option>
            </select>
          ) : (
            <input type="text" value={draft.value ?? ""} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="(no value needed for reject)" className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
          )}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-foreground">Priority (higher runs first)</span>
          <input type="number" value={draft.priority ?? 50} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} min={0} max={1000} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-foreground">Notes (admin-only)</span>
          <input type="text" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Why this rule exists" className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !draft.pattern || !draft.value} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-50">
          <Save className="h-3.5 w-3.5" />{editingId === "new" ? "Create rule" : "Save changes"}
        </button>
        <button type="button" onClick={cancel} className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover-elevate">
          <X className="h-3.5 w-3.5" />Cancel
        </button>
        {save.isError && <span className="text-xs text-destructive">Failed — check fields</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-card-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-foreground">Classification Rules</h2>
            <p className="mt-1 text-xs text-muted-foreground">Point-and-click routing the ingester applies to every new story. The default set sends obituaries to the People desk.</p>
          </div>
          {editingId === null && (
            <button type="button" onClick={startNew} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2">
              <Plus className="h-3.5 w-3.5" />Add rule
            </button>
          )}
        </div>
      </div>
      {editingId === "new" && ruleForm}
      <div className="rounded-lg border border-card-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Active</th><th className="px-3 py-2">If</th><th className="px-3 py-2">Then</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Hits</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No rules yet.</td></tr>}
            {rules.map((r) => editingId === r.id ? (
              <tr key={r.id}><td colSpan={6} className="px-3 py-3">{ruleForm}</td></tr>
            ) : (
              <tr key={r.id} className="border-t border-card-border">
                <td className="px-3 py-2">
                  <button type="button" onClick={() => toggleActive.mutate(r)} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-mono uppercase ${r.active ? "bg-primary/10 text-primary border border-primary/30" : "bg-secondary/60 text-muted-foreground"}`}>{r.active ? "ON" : "OFF"}</button>
                </td>
                <td className="px-3 py-2">
                  <div className="text-foreground">{FIELD_LABELS[r.matchField]} contains</div>
                  <div className="font-mono text-[0.78rem] text-muted-foreground break-all">{r.pattern}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-foreground">{ACTION_LABELS[r.action]}</div>
                  {r.action !== "reject" && <div className="font-mono text-[0.78rem] text-muted-foreground">{r.value}</div>}
                  {r.notes && <div className="mt-1 text-[0.7rem] italic text-muted-foreground">{r.notes}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.priority}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.hitCount}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => startEdit(r)} className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[0.7rem] hover-elevate"><Pencil className="h-3 w-3" />Edit</button>
                    <button type="button" onClick={() => { if (confirm(`Delete rule "${r.pattern}"?`)) remove.mutate(r.id); }} className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-[0.7rem] text-destructive hover-elevate"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
