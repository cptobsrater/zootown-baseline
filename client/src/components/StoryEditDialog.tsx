import { useEffect, useState } from "react";
import type { Story } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useAdminCity } from "@/lib/admin-city-context";
import { DESK_META, type DeskId } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Save, AlertTriangle, ExternalLink, X } from "lucide-react";

/**
 * Deletion reason categories. Must stay in lockstep with STORY_DELETION_REASONS
 * in shared/schema.ts and the Zod enum in server/routes.ts. These double as
 * training-signal labels: when the AI ingest mispicks a story, the human's
 * category here tells us what the model got wrong.
 */
const DELETION_REASONS: { value: string; label: string; hint: string }[] = [
  { value: "wrong_city", label: "Wrong city", hint: "Article isn't about this Montana city" },
  { value: "non_english", label: "Non-English", hint: "English-only rule" },
  { value: "duplicate", label: "Duplicate", hint: "Same story already published" },
  { value: "spam", label: "Spam / promo", hint: "Pure ad or SEO spam" },
  { value: "low_quality", label: "Low quality", hint: "Thin or unreadable" },
  { value: "wrong_desk", label: "Wrong desk", hint: "Miscategorized" },
  { value: "wrong_event_data", label: "Bad event data", hint: "Time/place wrong or unconfirmed" },
  { value: "outdated", label: "Outdated", hint: "Stale; no longer relevant" },
  { value: "opinion_or_editorial", label: "Opinion/editorial", hint: "Not news" },
  { value: "job_posting", label: "Job posting", hint: "Recruiting content" },
  { value: "classified", label: "Classified", hint: "For-sale / personals" },
  { value: "other", label: "Other", hint: "Explain in the box below" },
];

interface Props {
  story: Story | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save/delete so the parent can refresh. */
  onChange: () => void;
}

const DESK_LIST: DeskId[] = [
  "city", "business", "crime", "sports", "health", "entertainment", "people", "history",
];

const MOD_STATES = ["approved", "draft", "rejected"] as const;

/**
 * Convert a stored ISO timestamp like "2026-06-12T14:33:00.000Z" into the
 * format that <input type="datetime-local"> expects: "YYYY-MM-DDTHH:MM".
 * We render in the user's local timezone so admins see Mountain Time
 * (or whatever they're on), not UTC.
 */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse: take a local datetime-input string and return an ISO UTC string. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse the stored tags JSON ("[\"a\",\"b\"]") into an array. Returns [] if
 * the value is missing or malformed.
 */
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Full point-and-click story editor. Mounts as a centered Dialog over the
 * cockpit; loads its own copy of the story so it can be edited freely
 * without mutating the preview list until the user clicks Save.
 *
 * Editable fields:
 *   - Headline + summary (text)
 *   - Desk
 *   - City
 *   - Mod state (approved / draft / rejected)
 *   - Reviewed flag
 *   - Published at (datetime, local timezone)
 *   - Calendar: on_calendar toggle + starts_at + ends_at (locked unless on_calendar)
 *   - Source URL + source name
 *   - Tags (comma-separated)
 *   - Location
 *
 * Footer:
 *   - Delete (DELETE /api/admin/stories/:id, prompt-confirmed)
 *   - Save (PATCH /api/admin/stories/:id with only changed fields)
 */
export function StoryEditDialog({ story, open, onClose, onChange }: Props) {
  const { cities } = useAdminCity();
  // Local form state: a draft copy of the story that the user edits.
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [desk, setDesk] = useState<DeskId>("city");
  const [cityId, setCityId] = useState<number | undefined>(undefined);
  const [modState, setModState] = useState<(typeof MOD_STATES)[number]>("approved");
  const [isReviewed, setIsReviewed] = useState(false);
  const [publishedAtLocal, setPublishedAtLocal] = useState("");
  const [onCalendar, setOnCalendar] = useState(false);
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reasoned-delete UI state
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deleteCategory, setDeleteCategory] = useState<string>("");
  const [deleteReason, setDeleteReason] = useState("");

  // Reload form when a new story is selected.
  useEffect(() => {
    if (!story) return;
    setHeadline(story.headline ?? "");
    setSummary(story.summary ?? "");
    setDesk((story.desk as DeskId) ?? "city");
    setCityId(story.cityId ?? undefined);
    setModState((story.modState as any) ?? "approved");
    setIsReviewed(!!story.isReviewed);
    setPublishedAtLocal(isoToLocalInput(story.publishedAt));
    setOnCalendar(!!story.onCalendar);
    setStartsAtLocal(isoToLocalInput(story.startsAt));
    setEndsAtLocal(isoToLocalInput(story.endsAt));
    setSourceName(story.sourceName ?? "");
    setSourceUrl(story.sourceUrl ?? "");
    setTagsInput(parseTags(story.tags).join(", "));
    setLocation(story.location ?? "");
    setError(null);
    setShowDeleteForm(false);
    setDeleteCategory("");
    setDeleteReason("");
  }, [story?.id]);

  if (!story) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Build the patch payload with ONLY the fields that changed. Send
      // server-validated types: ISO strings for datetimes, JSON-stringified
      // tags array, numeric cityId.
      const payload: Record<string, unknown> = {};
      if (headline !== story!.headline) payload.headline = headline;
      if (summary !== story!.summary) payload.summary = summary;
      if (desk !== story!.desk) payload.desk = desk;
      if (cityId !== story!.cityId) payload.cityId = cityId;
      if (modState !== story!.modState) payload.modState = modState;
      if (isReviewed !== !!story!.isReviewed) payload.isReviewed = isReviewed;
      const newPub = localInputToIso(publishedAtLocal);
      if (newPub && newPub !== story!.publishedAt) payload.publishedAt = newPub;
      if (onCalendar !== !!story!.onCalendar) payload.onCalendar = onCalendar;
      const newStart = localInputToIso(startsAtLocal);
      if (newStart !== story!.startsAt) payload.startsAt = newStart;
      const newEnd = localInputToIso(endsAtLocal);
      if (newEnd !== story!.endsAt) payload.endsAt = newEnd;
      if (sourceName !== story!.sourceName) payload.sourceName = sourceName;
      if (sourceUrl !== story!.sourceUrl) payload.sourceUrl = sourceUrl;
      // Normalize the comma-separated tags input into the stored JSON-array form.
      const tagArr = tagsInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const tagsJson = JSON.stringify(tagArr);
      if (tagsJson !== story!.tags) payload.tags = tagsJson;
      const newLoc = location.trim() === "" ? null : location.trim();
      if (newLoc !== story!.location) payload.location = newLoc;

      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      const res = await apiRequest("PATCH", `/api/admin/stories/${story!.id}`, payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onChange();
      onClose();
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    // Server requires both a category and a non-empty reason. Bail early if
    // either is missing so we don't even attempt the round-trip.
    const trimmedReason = deleteReason.trim();
    if (!deleteCategory || trimmedReason.length < 3) {
      setError("Pick a category and write a short reason (3+ chars) before deleting.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest("DELETE", `/api/admin/stories/${story!.id}`, {
        reason: trimmedReason,
        reasonCategory: deleteCategory,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onChange();
      onClose();
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(720px,92vw)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Edit story #{story.id}
            <a
              href={story.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Open original source in a new tab"
            >
              View source <ExternalLink className="h-3 w-3" />
            </a>
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {/* Headline */}
          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Headline
            </label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Summary */}
          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Desk + City + ModState grid */}
          <div className="grid grid-cols-3 gap-3">
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
                <option value="">(no city)</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Mod state
              </label>
              <select
                value={modState}
                onChange={(e) => setModState(e.target.value as any)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {MOD_STATES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Published at + Reviewed */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Published at (local time)
              </label>
              <input
                type="datetime-local"
                value={publishedAtLocal}
                onChange={(e) => setPublishedAtLocal(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={isReviewed}
                  onChange={(e) => setIsReviewed(e.target.checked)}
                />
                Reviewed
              </label>
            </div>
          </div>

          {/* Calendar block */}
          <div className="rounded-md border border-border/60 bg-card/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onCalendar}
                onChange={(e) => setOnCalendar(e.target.checked)}
              />
              <span className="font-medium">Show on community calendar</span>
              <span className="text-[0.65rem] text-muted-foreground">
                (requires a confident start time)
              </span>
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

          {/* Source */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Source name
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
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
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Tags + Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Tags <span className="opacity-60">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="education, summer, missoula"
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
                placeholder="e.g. KettleHouse Amphitheater"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Reasoned-delete panel — every deletion is a labeled training signal.
            Choose a category, write a short reason, then Confirm. */}
        {showDeleteForm && (
          <div className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-destructive">
                Why are you deleting this story?
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteForm(false);
                  setDeleteCategory("");
                  setDeleteReason("");
                  setError(null);
                }}
                className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {DELETION_REASONS.map((r) => {
                const active = deleteCategory === r.value;
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setDeleteCategory(r.value)}
                    title={r.hint}
                    className={
                      "rounded-full border px-2.5 py-1 text-[0.7rem] transition " +
                      (active
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground")
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Detail (this trains the AI on what to filter)
            </label>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              placeholder="e.g. Story is about Helena, not Missoula — geo classifier picked the wrong city."
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={destroy}
                disabled={saving || !deleteCategory || deleteReason.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {saving ? "Deleting…" : "Confirm deletion"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <button
            type="button"
            onClick={() => setShowDeleteForm((v) => !v)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive hover:bg-destructive/15 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showDeleteForm ? "Hide delete form" : "Delete permanently…"}
          </button>
          <div className="flex items-center gap-2">
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
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
