import { useState } from "react";
import { Pin, PinOff, EyeOff, CalendarClock } from "lucide-react";
import type { Story } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  story: Story;
  /**
   * Optional callback: open the full edit dialog focused on the event-time
   * fields. Only rendered (and only visible) when story.onCalendar is true,
   * because event-time only makes sense for calendar items.
   */
  onEditEventTime?: () => void;
}

/**
 * Three quick-action icon buttons surfaced inside the Editable overlay on a
 * story card. Used by editorial mode only.
 *
 *   - Pin / Unpin  : toggles pinned_at (floats the row to the top of the feed)
 *   - Hide         : sets modState = "rejected" (removes from the public feed)
 *
 * Each button is its own POST/PATCH; on success we invalidate the stories
 * query so the feed updates without a full reload. Errors surface as a small
 * tooltip on the button.
 *
 * stopPropagation is critical: these buttons sit above the underlying card
 * which has its own click handler (open drawer). A click on the pin should
 * NEVER also open the article view.
 */
export function StoryQuickActions({ story, onEditEventTime }: Props) {
  const [busy, setBusy] = useState<null | "pin" | "hide">(null);
  const [error, setError] = useState<string | null>(null);
  const isPinned = !!story.pinnedAt;

  async function togglePin(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy("pin");
    setError(null);
    try {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/stories/${story.id}/pin`,
        { pinned: !isPinned },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function hide(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy("hide");
    setError(null);
    try {
      // PATCH /api/admin/stories/:id with modState: rejected reuses the same
      // edit endpoint that powers the cockpit dialog. We don't need a reason
      // here because the row stays in the DB (vs. delete which requires one).
      const res = await apiRequest("PATCH", `/api/admin/stories/${story.id}`, {
        modState: "rejected",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Common visual baseline: small square icon button, amber tint to match
  // the editorial-mode chrome, slight shadow for legibility over card art.
  const btn =
    "inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-amber-400/70 bg-amber-50 text-amber-900 shadow-md hover:bg-amber-100 disabled:opacity-50";

  return (
    <>
      {/* Event-time edit -- only for stories already on the calendar.
          Clicking jumps straight to the calendar block in the edit dialog. */}
      {story.onCalendar && onEditEventTime && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEditEventTime();
          }}
          title="Edit event time / location"
          aria-label="Edit event time"
          className={btn}
        >
          <CalendarClock className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={togglePin}
        disabled={busy !== null}
        title={isPinned ? "Unpin from top" : "Pin to top"}
        aria-label={isPinned ? "Unpin story" : "Pin story to top"}
        className={btn + (isPinned ? " ring-2 ring-amber-500" : "")}
      >
        {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={hide}
        disabled={busy !== null}
        title="Hide from public feed"
        aria-label="Hide story"
        className={btn}
      >
        <EyeOff className="h-3.5 w-3.5" />
      </button>
      {error && (
        <span className="ml-1 text-[0.6rem] text-destructive" title={error}>
          err
        </span>
      )}
    </>
  );
}
