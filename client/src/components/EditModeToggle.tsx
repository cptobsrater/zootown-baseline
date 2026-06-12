import { useLocation } from "wouter";
import { Pencil, Eye } from "lucide-react";
import { useEditMode } from "@/lib/edit-mode";

/**
 * Floating pill that only renders when an admin token is present in this tab.
 * Click it to flip editorial mode on/off (writes ?edit=1 to the URL).
 *
 * Positioning: bottom-right, stacked ABOVE the Feedback button (bottom-20 vs
 * bottom-5). Both share the same z-40 layer. The pill is suppressed on the
 * /feedback page and any /admin route -- those pages have their own chrome
 * and don't need the editor handle.
 *
 * Visual states:
 *   - Off mode (default): outline pill, "Edit this page" label, pencil glyph
 *   - On mode: filled accent pill, "Editing -- click to exit" label, eye glyph
 *
 * Why two visual states? The active state is intentionally loud so an admin
 * can never forget they're in edit mode (which would make accidental clicks
 * dangerous). The off state is muted so it doesn't fight the Feedback button.
 */
export function EditModeToggle() {
  const [location] = useLocation();
  const { isAdmin, isEditing, toggleEditing } = useEditMode();

  // Gate: only show when logged in, never on /feedback or /admin/*.
  if (!isAdmin) return null;
  if (location === "/feedback" || location.startsWith("/admin")) return null;

  return (
    <button
      type="button"
      onClick={toggleEditing}
      aria-label={isEditing ? "Exit editorial mode" : "Enter editorial mode"}
      aria-pressed={isEditing}
      title={isEditing ? "Exit editorial mode" : "Enter editorial mode"}
      className={
        "fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur transition hover-elevate sm:bottom-24 sm:right-6 " +
        (isEditing
          ? "border border-amber-400/50 bg-amber-400 text-amber-950"
          : "border border-border/60 bg-background/95 text-foreground")
      }
      data-testid="button-edit-mode-toggle"
    >
      {isEditing ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      <span className="hidden sm:inline">
        {isEditing ? "Editing live \u2014 exit" : "Edit this page"}
      </span>
    </button>
  );
}
