import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useAdminCity } from "@/lib/admin-city-context";
import { DESK_META, type DeskId } from "@/lib/format";
import { Save, AlertTriangle, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fires with the created row so the parent can refresh / scroll to it. */
  onCreated: (storyId: number) => void;
  /** Optional defaults: pre-pick the desk + city for one-click create flows. */
  defaultDesk?: DeskId;
  defaultCityId?: number;
}

const DESK_LIST: DeskId[] = [
  "city", "business", "crime", "sports", "health", "entertainment", "people", "history",
];

/**
 * Minimal "+ Add story" form for editorial mode. Captures just enough to make
 * a publishable card -- headline, summary, source link, desk, city, optional
 * calendar info -- and POSTs to /api/admin/stories. After save, the full row
 * comes back and the parent invalidates the feed query. Use the regular
 * pencil edit afterwards if you need to refine tags, location, etc.
 */
export function StoryCreateDialog({ open, onClose, onCreated, defaultDesk, defaultCityId }: Props) {
  const { cities } = useAdminCity();

  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [desk, setDesk] = useState<DeskId>(defaultDesk ?? "city");
  const [cityId, setCityId] = useState<number | undefined>(defaultCityId);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [location, setLocation] = useState("");
  const [onCalendar, setOnCalendar] = useState(false);
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens so it always starts blank.
  useEffect(() => {
    if (!open) return;
    setHeadline("");
    setSummary("");
    setDesk(defaultDesk ?? "city");
    setCityId(defaultCityId);
    setSourceName("");
    setSourceUrl("");
    setTagsInput("");
    setLocation("");
    setOnCalendar(false);
    setStartsAtLocal("");
    setEndsAtLocal("");
    setError(null);
  }, [open, defaultDesk, defaultCityId]);

  function localToIso(local: string): string | null {
    if (!local) return null;
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  async function submit() {
    if (!cityId) {
      setError("Pick a city.");
      return;
    }
    if (!headline.trim() || !summary.trim() || !sourceUrl.trim() || !sourceName.trim()) {
      setError("Headline, summary, source name, and source URL are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        headline: headline.trim(),
        summary: summary.trim(),
        desk,
        cityId,
        sourceName: sourceName.trim(),
        sourceUrl: sourceUrl.trim(),
        tags,
        location: location.trim() === "" ? null : location.trim(),
        onCalendar,
        startsAt: localToIso(startsAtLocal),
        endsAt: localToIso(endsAtLocal),
      };
      const res = await apiRequest("POST", "/api/admin/stories", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      const created = (await res.json()) as { id: number };
      onCreated(created.id);
      onClose();
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(640px,92vw)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Add a story
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Headline
            </label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="What happened?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              placeholder="2-4 sentences that stand on their own."
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Desk
              </label>
              <select
                value={desk}
                onChange={(e) => setDesk(e.target.value as DeskId)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {DESK_LIST.map((d) => (
                  <option key={d} value={d}>
                    {DESK_META[d]?.label ?? d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                City
              </label>
              <select
                value={cityId ?? ""}
                onChange={(e) => setCityId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">(pick one)</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Source name
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Missoula Current"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Source URL
              </label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Tags <span className="opacity-60">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="local, summer"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Location <span className="opacity-60">(optional)</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Caras Park"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Calendar fields -- only required when the admin opts in. The
              server validates the timestamp string, so we send raw ISO. */}
          <div className="rounded-md border border-border/60 bg-card/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onCalendar}
                onChange={(e) => setOnCalendar(e.target.checked)}
              />
              <span className="font-medium">This is an event (show on community calendar)</span>
            </label>
            {onCalendar && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                    Starts at
                  </label>
                  <input
                    type="datetime-local"
                    value={startsAtLocal}
                    onChange={(e) => setStartsAtLocal(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                    Ends at <span className="opacity-60">(optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={endsAtLocal}
                    onChange={(e) => setEndsAtLocal(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Publishing…" : "Publish story"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
