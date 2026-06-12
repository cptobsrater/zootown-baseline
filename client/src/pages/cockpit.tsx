/**
 * Phase 6 Editorial Cockpit
 * --------------------------------------------------------------------------
 *
 * Three-pane workspace for admins to build, save, apply, and reuse composite
 * feed filters across cities, desks, mod states, and time windows. Backed by
 * the /api/admin/presets* endpoints and the feedPresets / feedPresetEvents
 * tables shipped in the Phase 6 backend scaffold.
 *
 * Layout:
 *   [Sidebar: My Presets + Suggested]  [Editor: filter knobs]  [Right: live story preview]
 *
 * Save / Apply / Delete each emit a feed_preset_event so the suggestion
 * engine can learn from real usage patterns. Apply is telemetry-only --
 * the actual filter is rendered by hitting /preview with the preset's
 * config, NOT by hitting Apply server-side.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { apiRequest, getAdminToken } from "@/lib/queryClient";
import { AdminCityProvider, useAdminCity } from "@/lib/admin-city-context";
import { DESK_META, type DeskId } from "@/lib/format";
import { StoryEditDialog } from "@/components/StoryEditDialog";
import { Pencil, Inbox, MessageSquare } from "lucide-react";
import type { Story } from "@shared/schema";

// ---- Types mirroring the server payloads ----

type FeedPresetSort = "newest" | "highest_confidence" | "approved_first";
type FeedPresetScope = "personal" | "shared" | "org";

interface FeedPresetConfig {
  desks: DeskId[];
  citySlug?: string;
  modState: "all" | "approved" | "draft" | "rejected";
  isReviewed?: boolean;
  query?: string;
  timeWindowHours?: number;
  sort: FeedPresetSort;
  display: { showDeskStripes: boolean; sortByEventDate: boolean };
  signals: { origin: "manual" | "suggested" | "imported" };
}

interface FeedPreset {
  id: number;
  ownerId: string | null;
  scope: FeedPresetScope;
  name: string;
  slug: string;
  config: FeedPresetConfig;
  cityId: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  configVersion: number;
}

interface FilterSignature {
  filterSignature: string;
  applies: number;
  cityId: number | null;
}

const DEFAULT_CONFIG: FeedPresetConfig = {
  desks: [],
  modState: "approved",
  sort: "newest",
  display: { showDeskStripes: true, sortByEventDate: false },
  signals: { origin: "manual" },
};

const DESK_LIST: DeskId[] = [
  "city",
  "business",
  "crime",
  "sports",
  "health",
  "entertainment",
  "people",
  "history",
];

const SORT_OPTIONS: { value: FeedPresetSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "highest_confidence", label: "Highest confidence" },
  { value: "approved_first", label: "Approved first" },
];

const TIME_WINDOWS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "All time" },
  { value: 24, label: "Past 24h" },
  { value: 72, label: "Past 3 days" },
  { value: 168, label: "Past week" },
  { value: 720, label: "Past month" },
];

function deskColor(desk: DeskId): string {
  return `hsl(var(--desk-${desk}))`;
}

// ============================================================================
// Sub-components
// ============================================================================

function DeskChip({
  desk,
  active,
  onClick,
}: {
  desk: DeskId;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      style={
        active
          ? {
              background: deskColor(desk),
              color: "#0b0b0b",
              borderColor: deskColor(desk),
            }
          : {
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }
      }
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: deskColor(desk) }}
      />
      {DESK_META[desk]?.label ?? desk}
    </button>
  );
}

function PresetListItem({
  preset,
  active,
  onSelect,
  onApply,
  onDelete,
}: {
  preset: FeedPreset;
  active: boolean;
  onSelect: () => void;
  onApply: () => void;
  onDelete: () => void;
}) {
  const desks = preset.config.desks;
  return (
    <div
      className="group flex flex-col gap-1 rounded-md border border-border/60 bg-card/40 p-3 transition-colors hover:border-border"
      style={active ? { borderColor: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.06)" } : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        className="text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{preset.name}</span>
          <span className="text-[0.62rem] font-mono uppercase tracking-[0.12em] text-muted-foreground/70">
            v{preset.configVersion}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {desks.length === 0 ? (
            <span className="text-[0.62rem] uppercase tracking-[0.1em] text-muted-foreground">All desks</span>
          ) : (
            desks.map((d) => (
              <span
                key={d}
                className="rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.1em]"
                style={{ background: `${deskColor(d)} / 0.18`, color: deskColor(d) }}
              >
                {d}
              </span>
            ))
          )}
        </div>
      </button>
      <div className="mt-1 flex items-center justify-between gap-2 text-[0.62rem] text-muted-foreground">
        <span>
          {preset.config.modState === "approved" ? "Approved" : preset.config.modState} ·{" "}
          {preset.config.sort.replace(/_/g, " ")}
        </span>
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onApply}
            className="rounded-md border border-border bg-background px-2 py-0.5 hover-elevate"
            title="Apply this preset"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-destructive hover:bg-destructive/15"
            title="Soft-delete this preset"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main cockpit
// ============================================================================

function CockpitInner() {
  const { cities, currentCity, setCurrentCitySlug } = useAdminCity();
  const [config, setConfig] = useState<FeedPresetConfig>(DEFAULT_CONFIG);
  const [presets, setPresets] = useState<FeedPreset[]>([]);
  const [signatures, setSignatures] = useState<FilterSignature[]>([]);
  const [preview, setPreview] = useState<{ items: Story[]; total: number }>({
    items: [],
    total: 0,
  });
  const [activePresetId, setActivePresetId] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When non-null, a story is open in the editor dialog.
  const [editing, setEditing] = useState<Story | null>(null);
  // Feedback inbox (cockpit triage panel). Loaded on mount + after any
  // PATCH so the open count badge stays accurate.
  const [feedbackItems, setFeedbackItems] = useState<any[]>([]);
  const [openFeedbackCount, setOpenFeedbackCount] = useState(0);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<"open" | "in_progress" | "resolved" | "archived" | "all">("open");

  // Load + reload feedback whenever the filter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/admin/feedback?status=${feedbackStatusFilter}&limit=100`);
        const body = await res.json();
        if (cancelled) return;
        setFeedbackItems(body.items ?? []);
        setOpenFeedbackCount(body.openCount ?? 0);
      } catch {
        /* admin can retry by changing the filter */
      }
    })();
    return () => { cancelled = true; };
  }, [feedbackStatusFilter]);

  async function patchFeedback(id: number, patch: Record<string, unknown>) {
    try {
      const res = await apiRequest("PATCH", `/api/admin/feedback/${id}`, patch);
      if (!res.ok) return;
      const updated = await res.json();
      setFeedbackItems((prev) => prev.map((f) => (f.id === id ? updated : f)));
      // Refresh open count via a quick re-list -- cheap, single query.
      const r = await apiRequest("GET", `/api/admin/feedback?status=open&limit=1`);
      const b = await r.json();
      setOpenFeedbackCount(b.openCount ?? 0);
    } catch {}
  }

  // Load presets + signatures whenever the admin's city changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const presetsRes = await apiRequest(
          "GET",
          `/api/admin/presets?cityId=${currentCity.id}`,
        );
        const presetsBody = await presetsRes.json();
        if (!cancelled) setPresets(presetsBody.presets ?? []);
        const sigsRes = await apiRequest(
          "GET",
          `/api/admin/preset-signatures?days=14&limit=8`,
        );
        const sigsBody = await sigsRes.json();
        if (!cancelled) setSignatures(sigsBody.signatures ?? []);
      } catch (e: any) {
        if (!cancelled) setError(`Failed to load presets: ${e?.message ?? e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCity.id]);

  // Debounced live preview: hits /api/admin/presets/preview whenever the
  // config changes. The server runs listStoriesByPreset which applies the
  // composite confidence weighting + alt_desks overlap.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await apiRequest("POST", `/api/admin/presets/preview`, {
          config,
          cityId: currentCity.id,
          limit: 30,
        });
        const body = await res.json();
        if (!cancelled) setPreview({ items: body.items ?? [], total: body.total ?? 0 });
      } catch (e: any) {
        if (!cancelled) setError(`Preview failed: ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [config, currentCity.id]);

  // ----- Mutations -----

  const toggleDesk = (d: DeskId) => {
    setConfig((c) => {
      const has = c.desks.includes(d);
      return {
        ...c,
        desks: has ? c.desks.filter((x) => x !== d) : [...c.desks, d],
      };
    });
  };

  const savePreset = async () => {
    if (!presetName.trim()) {
      setError("Give the preset a name first.");
      return;
    }
    setSaveStatus("Saving…");
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/admin/presets`, {
        name: presetName.trim(),
        scope: "personal" as FeedPresetScope,
        config,
        cityId: currentCity.id,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      setPresets((p) => [...p, body.preset]);
      setActivePresetId(body.preset.id);
      setSaveStatus(`Saved "${body.preset.name}"`);
      setPresetName("");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (e: any) {
      setError(`Save failed: ${e?.message ?? e}`);
      setSaveStatus(null);
    }
  };

  const applyPreset = async (preset: FeedPreset) => {
    setActivePresetId(preset.id);
    setConfig(preset.config);
    // Telemetry: tell the server we applied this preset. Doesn't block UI.
    apiRequest("POST", `/api/admin/presets/${preset.id}/apply`).catch(() => {});
  };

  const deletePreset = async (preset: FeedPreset) => {
    if (!confirm(`Delete preset "${preset.name}"? This can't be undone.`)) return;
    try {
      const res = await apiRequest("DELETE", `/api/admin/presets/${preset.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPresets((p) => p.filter((x) => x.id !== preset.id));
      if (activePresetId === preset.id) setActivePresetId(null);
    } catch (e: any) {
      setError(`Delete failed: ${e?.message ?? e}`);
    }
  };

  // ----- Render helpers -----

  const summaryLine = useMemo(() => {
    const parts: string[] = [];
    parts.push(config.desks.length === 0 ? "All desks" : `${config.desks.length} desk(s)`);
    parts.push(`mod=${config.modState}`);
    if (config.timeWindowHours) parts.push(`window=${config.timeWindowHours}h`);
    if (config.query) parts.push(`q="${config.query}"`);
    parts.push(`sort=${config.sort.replace(/_/g, " ")}`);
    return parts.join(" · ");
  }, [config]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <Link href="/admin">
          <a className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
            ← Admin
          </a>
        </Link>
        <span className="font-serif text-lg font-semibold">Editorial Cockpit</span>
        <span className="text-[0.7rem] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Phase 6
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs text-muted-foreground">City</label>
          <select
            value={currentCity.slug}
            onChange={(e) => setCurrentCitySlug(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Error toast */}
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}{" "}
          <button onClick={() => setError(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Three-pane workspace */}
      <main className="grid h-[calc(100vh-3.25rem)] grid-cols-[280px_minmax(0,1fr)_440px] gap-0 overflow-hidden">
        {/* ---- Left: presets sidebar ---- */}
        <aside className="overflow-y-auto border-r border-border/60 bg-card/30 p-4">
          <h2 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
            My Presets
          </h2>
          <button
            type="button"
            onClick={() => {
              setConfig(DEFAULT_CONFIG);
              setActivePresetId(null);
            }}
            className="mb-3 w-full rounded-md border border-dashed border-border bg-transparent px-2 py-2 text-xs text-muted-foreground hover-elevate"
          >
            + New preset (clear filters)
          </button>
          <div className="space-y-2">
            {presets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No presets yet. Tweak filters on the right, give the preset a name, click Save.
              </p>
            ) : (
              presets.map((p) => (
                <PresetListItem
                  key={p.id}
                  preset={p}
                  active={activePresetId === p.id}
                  onSelect={() => {
                    setActivePresetId(p.id);
                    setConfig(p.config);
                  }}
                  onApply={() => applyPreset(p)}
                  onDelete={() => deletePreset(p)}
                />
              ))
            )}
          </div>

          <h2 className="mt-6 mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
            Suggested (14d)
          </h2>
          {signatures.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing yet — usage data accumulates as presets are applied.
            </p>
          ) : (
            <div className="space-y-1">
              {signatures.map((sig) => (
                <div
                  key={sig.filterSignature}
                  className="rounded-md border border-border/40 bg-card/20 p-2 text-[0.62rem] font-mono text-muted-foreground"
                >
                  <div className="truncate" title={sig.filterSignature}>
                    {sig.filterSignature}
                  </div>
                  <div className="mt-0.5 text-muted-foreground/70">
                    {sig.applies} applies
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Feedback inbox: surface user-submitted feedback right here in
              the cockpit so the same person who triages stories also sees
              the bug reports / feature requests / fact-corrections. */}
          <h2 className="mt-6 mb-2 flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            User feedback
            {openFeedbackCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[0.55rem] font-medium text-amber-600 dark:text-amber-400">
                {openFeedbackCount} open
              </span>
            )}
          </h2>
          <select
            value={feedbackStatusFilter}
            onChange={(e) => setFeedbackStatusFilter(e.target.value as any)}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-[0.7rem] text-muted-foreground"
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <div className="space-y-2">
            {feedbackItems.length === 0 ? (
              <p className="text-[0.7rem] text-muted-foreground">No feedback in this bucket.</p>
            ) : (
              feedbackItems.map((f) => (
                <div key={f.id} className="rounded-md border border-border/40 bg-card/30 p-2 text-[0.7rem]">
                  <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground">
                    <span>#{f.id}</span>
                    <span>
                      {new Date(f.createdAt).toLocaleString(undefined, {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {f.citySlug && <span className="ml-auto uppercase tracking-[0.1em]">{f.citySlug}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                    {f.body}
                  </p>
                  {(f.name || f.email) && (
                    <p className="mt-1 text-[0.6rem] text-muted-foreground">
                      from {f.name ?? "anonymous"}
                      {f.email && <> · <a href={`mailto:${f.email}`} className="underline">{f.email}</a></>}
                    </p>
                  )}
                  {f.pageUrl && (
                    <p className="mt-1 text-[0.6rem] text-muted-foreground/70">
                      on <a href={f.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">{f.pageUrl}</a>
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {["open", "in_progress", "resolved", "archived"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => patchFeedback(f.id, { status: s })}
                        className={`rounded-full border px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.1em] ${
                          f.status === s
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border/40 bg-background/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ---- Center: filter editor ---- */}
        <section className="overflow-y-auto p-6">
          <div className="mb-1 flex items-center gap-3">
            <h1 className="font-serif text-xl font-semibold">Filter editor</h1>
            <span className="text-[0.62rem] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              {summaryLine}
            </span>
          </div>
          <p className="mb-6 text-xs text-muted-foreground">
            Build a composite query. The right pane updates live. Save when you like the recipe.
          </p>

          {/* Desks */}
          <div className="mb-6">
            <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
              Desks {config.desks.length > 0 && `(${config.desks.length} selected)`}
            </h3>
            <div className="flex flex-wrap gap-2">
              {DESK_LIST.map((d) => (
                <DeskChip
                  key={d}
                  desk={d}
                  active={config.desks.includes(d)}
                  onClick={() => toggleDesk(d)}
                />
              ))}
            </div>
            <p className="mt-2 text-[0.65rem] text-muted-foreground/70">
              Empty selection = all desks. Multiple = composite OR (with alt_desks
              overlap when sort = highest confidence).
            </p>
          </div>

          {/* Mod state + sort + window grid */}
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div>
              <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Mod state
              </h3>
              <select
                value={config.modState}
                onChange={(e) =>
                  setConfig({ ...config, modState: e.target.value as any })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="approved">Approved</option>
                <option value="draft">Draft</option>
                <option value="rejected">Rejected</option>
                <option value="all">All</option>
              </select>
            </div>
            <div>
              <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Sort
              </h3>
              <select
                value={config.sort}
                onChange={(e) =>
                  setConfig({ ...config, sort: e.target.value as FeedPresetSort })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Time window
              </h3>
              <select
                value={config.timeWindowHours ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    timeWindowHours: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {TIME_WINDOWS.map((w) => (
                  <option key={String(w.value)} value={w.value ?? ""}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Query */}
          <div className="mb-6">
            <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
              Stored query
            </h3>
            <input
              type="text"
              value={config.query ?? ""}
              onChange={(e) =>
                setConfig({ ...config, query: e.target.value || undefined })
              }
              placeholder="Optional. Matches headline/summary/tags/location."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Display + reviewed toggles */}
          <div className="mb-8 grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!config.display.sortByEventDate}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    display: { ...config.display, sortByEventDate: e.target.checked },
                  })
                }
              />
              Sort future events by start time
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!config.display.showDeskStripes}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    display: { ...config.display, showDeskStripes: e.target.checked },
                  })
                }
              />
              Show desk color stripes on cards
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.isReviewed === true}
                ref={(el) => {
                  if (el) el.indeterminate = config.isReviewed === undefined;
                }}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    isReviewed:
                      config.isReviewed === undefined
                        ? true
                        : config.isReviewed
                        ? false
                        : undefined,
                  })
                }
              />
              Reviewed only{" "}
              <span className="text-[0.65rem] text-muted-foreground">
                ({config.isReviewed === undefined ? "any" : config.isReviewed ? "reviewed" : "unreviewed"})
              </span>
            </label>
          </div>

          {/* Save bar */}
          <div className="rounded-md border border-border/60 bg-card/30 p-4">
            <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
              Save this recipe
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder='Preset name e.g. "Helena · Crime + Health, past week"'
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={savePreset}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate"
              >
                Save
              </button>
            </div>
            {saveStatus && (
              <p className="mt-2 text-xs text-emerald-500">{saveStatus}</p>
            )}
          </div>
        </section>

        {/* ---- Right: live preview ---- */}
        <aside className="overflow-y-auto border-l border-border/60 bg-card/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
              Live preview
            </h2>
            <span className="text-xs text-muted-foreground">
              {previewLoading
                ? "Loading…"
                : `${preview.items.length} of ${preview.total}`}
            </span>
          </div>
          <div className="space-y-2">
            {preview.items.length === 0 && !previewLoading && (
              <p className="text-xs text-muted-foreground">
                No stories match this combination of filters in {currentCity.displayName}.
              </p>
            )}
            {preview.items.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setEditing(s)}
                className="group block w-full cursor-pointer rounded-md border border-border/40 bg-card/40 p-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-card/70"
                title="Click to edit this story"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.1em]"
                    style={{ background: deskColor(s.desk as DeskId), color: "#0b0b0b" }}
                  >
                    {s.desk}
                  </span>
                  <span className="text-[0.6rem] text-muted-foreground">
                    {new Date(s.publishedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {s.modState !== "approved" && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.1em] text-amber-500">
                      {s.modState}
                    </span>
                  )}
                  {s.onCalendar && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.1em] text-emerald-500">
                      event
                    </span>
                  )}
                  <Pencil className="ml-auto h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <h3 className="mt-1 font-medium leading-tight text-foreground">
                  {s.headline}
                </h3>
                <p className="mt-1 line-clamp-2 text-[0.7rem] text-muted-foreground">
                  {s.summary}
                </p>
              </button>
            ))}
          </div>
        </aside>
      </main>

      {/* Point-and-click story editor. Floats above all three panes;
          refreshes the preview on save/delete by toggling the config
          reference so the existing debounced preview effect re-fires. */}
      <StoryEditDialog
        story={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onChange={() => setConfig((c) => ({ ...c }))}
      />
    </div>
  );
}

// ============================================================================
// Top-level wrapper: guards on admin token, wires AdminCityProvider
// ============================================================================

export default function CockpitPage() {
  const token = getAdminToken();
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="max-w-md rounded-md border border-border bg-card p-6">
          <h1 className="font-serif text-2xl">Cockpit needs admin sign-in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The editorial cockpit is behind the admin login.
          </p>
          <Link href="/admin">
            <a className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover-elevate">
              Sign in →
            </a>
          </Link>
        </div>
      </div>
    );
  }
  return (
    <AdminCityProvider>
      <CockpitInner />
    </AdminCityProvider>
  );
}
