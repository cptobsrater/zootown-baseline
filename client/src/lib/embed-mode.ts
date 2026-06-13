/**
 * Embed mode: when ?embed=1 is in the URL, the public site knows it's
 * running INSIDE the cockpit's live-preview iframe. That changes a few
 * behaviors:
 *
 *   - Clicking a story card forwards a postMessage to the parent instead
 *     of opening the regular story drawer.
 *   - Clicking a sponsor banner does the same.
 *   - The floating "Edit this page" pill is hidden (the parent cockpit
 *     toolbar already provides controls).
 *   - The Feedback button is hidden (it would duplicate the parent's).
 *   - The parent can postMessage("zt:invalidate") to force the iframe's
 *     react-query cache to refetch the feed after a save.
 *
 * Single source of truth so we don't sprinkle `if (params.get("embed"))`
 * checks across the codebase.
 */
import { useEffect, useState } from "react";
import { queryClient } from "./queryClient";

function readEmbedFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

/**
 * Hook returning whether this page is currently embedded in the cockpit.
 * Also wires up a listener that lets the parent invalidate caches from
 * across the iframe boundary.
 */
export function useEmbedMode(): boolean {
  // Embed flag is set on first paint and never changes during the lifetime
  // of the page -- the parent cockpit reassigns iframe.src to navigate, so
  // we don't need to react to mid-life changes.
  const [embed] = useState<boolean>(() => readEmbedFromUrl());

  useEffect(() => {
    if (!embed) return;
    function onMessage(e: MessageEvent) {
      // Same-origin guard. The iframe lives at the same host as the parent
      // cockpit, so any message from a different origin is suspicious.
      if (e.origin !== window.location.origin) return;
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "zt:invalidate") {
        // Bust the feed caches so the next render shows the parent's edits.
        queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
        queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed]);

  return embed;
}

/**
 * Forward a story selection to the parent cockpit when running embedded.
 * No-op when not embedded -- caller should still fall back to opening the
 * drawer for the normal case (see Home.tsx).
 */
export function postSelectStoryToParent(story: unknown): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  if (!readEmbedFromUrl()) return false;
  window.parent.postMessage(
    { type: "zt:select-story", story },
    window.location.origin,
  );
  return true;
}

export function postSelectSponsorToParent(sponsorId: string): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  if (!readEmbedFromUrl()) return false;
  window.parent.postMessage(
    { type: "zt:select-sponsor", sponsorId },
    window.location.origin,
  );
  return true;
}
