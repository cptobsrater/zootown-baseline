import { useEffect, useState } from "react";
import type { Story } from "@shared/schema";
import { DESKS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, X, Save } from "lucide-react";

interface Props {
  story: Story;
  onClose: () => void;
}

export function EditStoryModal({ story, onClose }: Props) {
  const [headline, setHeadline] = useState(story.headline);
  const [summary, setSummary] = useState(story.summary);
  const [desk, setDesk] = useState(story.desk);
  const [sourceUrl, setSourceUrl] = useState(story.sourceUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const patch: Record<string, string> = {};
    if (headline !== story.headline) patch.headline = headline;
    if (summary !== story.summary) patch.summary = summary;
    if (desk !== story.desk) patch.desk = desk;
    if (sourceUrl !== story.sourceUrl) patch.sourceUrl = sourceUrl;

    if (Object.keys(patch).length === 0) {
      setBusy(false);
      onClose();
      return;
    }

    try {
      await apiRequest("PATCH", `/api/admin/stories/${story.id}`, patch);
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pulse"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/edits"] });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Save failed.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      data-testid="modal-edit-story"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-lg border border-card-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Edit story · #{story.id}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {story.sourceName} · saved changes are logged
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="button-close-edit"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background hover-elevate"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Headline
            </label>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              data-testid="input-edit-headline"
              className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={5}
              data-testid="input-edit-summary"
              className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none resize-y"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                Desk
              </label>
              <select
                value={desk}
                onChange={(e) => setDesk(e.target.value)}
                data-testid="select-edit-desk"
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
              >
                {DESKS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                Source URL
              </label>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                data-testid="input-edit-source-url"
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-edit-error"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[0.7rem] text-muted-foreground">
            Every changed field is logged so we can spot patterns in parser misclassification.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              data-testid="button-cancel-edit"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover-elevate"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              data-testid="button-save-edit"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
