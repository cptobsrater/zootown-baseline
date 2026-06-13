import { useLocation } from "wouter";
import { MessageSquare } from "lucide-react";

/**
 * Floating "Feedback" button shown on every page that isn't the feedback
 * page itself or an admin area. Clicking it navigates to /feedback with
 * the current path passed as ?from= so the admin can see what page the
 * user was on when they submitted.
 *
 * Position: bottom-left on mobile, bottom-right on desktop -- low enough
 * not to crowd content, high enough to remain visible above iOS Safari's
 * collapsing URL bar. Z-index sits below modal dialogs (z-50) so it never
 * blocks the editor or share dropdowns.
 */
export function FeedbackButton() {
  const [location, navigate] = useLocation();
  // Suppress on the feedback page itself + any admin route (admins use the
  // cockpit's "Feedback" panel, not this button). Also suppress when this
  // page is embedded inside the cockpit's live-preview iframe (?embed=1).
  if (location === "/feedback" || location.startsWith("/admin")) return null;
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1") return null;

  function go() {
    const from = typeof window !== "undefined" ? window.location.pathname + window.location.search : location;
    navigate(`/feedback?from=${encodeURIComponent(from)}`);
  }

  return (
    <button
      type="button"
      onClick={go}
      aria-label="Send feedback"
      title="Send feedback"
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg backdrop-blur hover-elevate sm:bottom-6 sm:right-6"
      data-testid="button-feedback-float"
    >
      <MessageSquare className="h-4 w-4" />
      <span className="hidden sm:inline">Feedback</span>
    </button>
  );
}
