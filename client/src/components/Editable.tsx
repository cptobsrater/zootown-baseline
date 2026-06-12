import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useEditMode } from "@/lib/edit-mode";

interface Props {
  /** What the wrapper looks like in read-only mode -- just renders children. */
  children: ReactNode;
  /** Fired when the admin clicks the pencil overlay. Hand back the edit dialog. */
  onEdit: () => void;
  /** Short label shown in the overlay corner; e.g. "Edit story" or "Edit sponsor". */
  label?: string;
  /**
   * Optional className applied to the OUTER wrapper. Use this for layout
   * sizing (block, flex item, etc.). The inner content is unchanged.
   */
  className?: string;
  /**
   * Optional quick-action buttons rendered to the LEFT of the pencil button.
   * Use this for pin/hide/etc. so the call site can pass any actions it wants
   * without forcing them on every Editable consumer.
   */
  quickActions?: ReactNode;
}

/**
 * Generic wrapper that adds a hover-to-edit affordance when editorial mode
 * is on. When off, this component is invisible: it just renders the children
 * with no extra markup chrome.
 *
 * In edit mode:
 *   - The wrapper gets a dashed outline on hover so the admin can see the
 *     edit target.
 *   - A small pencil button appears in the top-right corner of the hovered
 *     element. Click -> fires onEdit().
 *   - We swallow the click on the pencil so it doesn't fall through to any
 *     <a> or onClick on the underlying card.
 *
 * Why a wrapper instead of editing the cards in place? Cards already have
 * click handlers for opening the drawer / following sponsor links. We don't
 * want to touch those; a wrapper layer lets us add edit affordances without
 * forking the card components.
 */
export function Editable({ children, onEdit, label = "Edit", className, quickActions }: Props) {
  const { isEditing } = useEditMode();
  const [hovered, setHovered] = useState(false);

  // Fast path: when not editing, render children with no wrapper at all so
  // public visitors get the exact same DOM as before this feature shipped.
  if (!isEditing) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  function onPencil(e: React.MouseEvent) {
    // Stop the underlying card's click handler from firing.
    e.preventDefault();
    e.stopPropagation();
    onEdit();
  }

  return (
    <div
      className={
        "group relative " +
        (hovered ? "outline outline-2 outline-offset-2 outline-amber-400/70 rounded-md " : "") +
        (className ?? "")
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <div
        className={
          "absolute right-2 top-2 z-30 flex items-center gap-1 transition " +
          (hovered ? "opacity-100" : "opacity-0 pointer-events-none")
        }
      >
        {quickActions}
        <button
          type="button"
          onClick={onPencil}
          aria-label={label}
          title={label}
          className="inline-flex items-center gap-1 rounded-md border border-amber-400/70 bg-amber-400 px-2 py-1 text-[0.7rem] font-medium text-amber-950 shadow-md"
        >
          <Pencil className="h-3 w-3" />
          {label}
        </button>
      </div>
    </div>
  );
}
