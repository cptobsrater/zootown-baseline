/**
 * Cockpit + Live Preview - side-by-side authoring workspace.
 *
 *   [ INSPECTOR ]  [          LIVE IFRAME            ]
 *   - Story list   - Public city page in ?edit=1 mode
 *   - Story form   - Click any card -> jumps inspector to it
 *   - Save / pin   - Pencil overlays still work in the iframe
 *
 * The two panes talk over window.postMessage:
 *
 *   iframe -> parent: { type: "zt:select-story",  storyId }
 *   iframe -> parent: { type: "zt:select-sponsor", sponsorId }
 *   parent -> iframe: { type: "zt:invalidate" }   (refetch feed after save)
 *   parent -> iframe: { type: "zt:navigate", citySlug }
 *
 * The iframe src is `/<citySlug>?edit=1&embed=1`. The embed flag tells the
 * public page it's running inside the cockpit so it can post selection
 * events back instead of opening the regular drawer.
 *
 * Auth: the iframe is same-origin, so the in-memory admin token in the
 * parent tab is also available to the iframe's queryClient via shared
 * module state (queryClient.ts holds the token in module scope).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AdminCityProvider, useAdminCity } from "@/lib/admin-city-context";
import { queryClient } from "@/lib/queryClient";
import { StoryEditDialog } from "@/components/StoryEditDialog";
import { SponsorEditDialog } from "@/components/SponsorEditDialog";
import { StoryCreateDialog } from "@/components/StoryCreateDialog";
import { Wordmark } from "@/components/Logo";
import { AdminCitySwitcher } from "@/components/admin/AdminCitySwitcher";
import {
  ArrowLeft, RefreshCw, ExternalLink, Plus, ShieldAlert, LayoutGrid,
} from "lucide-react";
import type { Story } from "@shared/schema";

type SelectedTarget =
  | { kind: "story"; story: Story }
  | { kind: "sponsor"; sponsorId: string }
  | null;

function CockpitLiveInner() {
  const { currentCity } = useAdminCity();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // What the inspector pane is currently focused on. Driven by clicks in
  // the iframe (postMessage) or by the +Add button on the toolbar.
  const [target, setTarget] = useState<SelectedTarget>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Build the iframe URL fresh on every city change. We append ?edit=1 so
  // the floating pill is auto-active, and embed=1 so the public page knows
  // it's inside the cockpit (used to post selection events back).
  const iframeSrc = `/${currentCity.slug}?edit=1&embed=1`;

  // Listen for selection messages from the iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Same-origin guard. The iframe is loaded from the same host, so any
      // message from a different origin is from somewhere else and ignored.
      if (e.origin !== window.location.origin) return;
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "zt:select-story" && msg.story) {
        setTarget({ kind: "story", story: msg.story as Story });
      } else if (msg.type === "zt:select-sponsor" && typeof msg.sponsorId === "string") {
        setTarget({ kind: "sponsor", sponsorId: msg.sponsorId });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Helper: tell the iframe to refetch its feed (used after save/delete/pin).
  function refreshIframe() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "zt:invalidate" }, window.location.origin);
  }

  // Helper: hard-reload the iframe (used when changing cities or when the
  // soft refresh isn't enough).
  function reloadIframe() {
    const f = iframeRef.current;
    if (!f) return;
    // Reassign src to force a full reload (setting .src to the same value
    // doesn't always trigger a navigation; the cache-buster query does).
    f.src = `${iframeSrc}&t=${Date.now()}`;
  }

  // When the admin switches city in the toolbar, AdminCityProvider updates
  // currentCity which changes iframeSrc -- React re-renders <iframe> with
  // a new src and the page navigates inside the embed.

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* ===== Toolbar ===== */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background px-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover-elevate"
          >
            <ArrowLeft className="h-3 w-3" />
            Admin
          </Link>
          <Link href="/" aria-label="ZooTown home">
            <Wordmark />
          </Link>
          <AdminCitySwitcher />
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
            Live cockpit
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-2.5 py-1 text-xs font-medium text-amber-950 hover:bg-amber-500"
          >
            <Plus className="h-3 w-3" />
            Add story
          </button>
          <button
            type="button"
            onClick={reloadIframe}
            title="Reload the preview iframe"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover-elevate"
          >
            <RefreshCw className="h-3 w-3" />
            Reload
          </button>
          <a
            href={`/${currentCity.slug}?edit=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover-elevate"
          >
            <ExternalLink className="h-3 w-3" />
            Open in tab
          </a>
          <Link
            href="/admin/cockpit"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover-elevate"
          >
            <LayoutGrid className="h-3 w-3" />
            Classic cockpit
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-destructive">
            <ShieldAlert className="h-3 w-3" />
            Internal
          </div>
        </div>
      </header>

      {/* ===== Body =====
          The live public site fills the viewport. Clicking a card or
          sponsor in the iframe posts a message; we open the relevant edit
          dialog as a modal over the cockpit so the preview stays visible. */}
      <main className="relative flex-1 overflow-hidden bg-background">
        {!target && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-amber-400/60 bg-amber-50/95 px-4 py-1.5 text-xs font-medium text-amber-900 shadow-md">
            Click any story card or sponsor banner to edit it.
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="ZooTown live preview"
          src={iframeSrc}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </main>

      {target?.kind === "story" && (
        <StoryEditDialog
          story={target.story}
          open={true}
          onClose={() => setTarget(null)}
          onChange={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
            queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
            refreshIframe();
          }}
        />
      )}
      {target?.kind === "sponsor" && (
        <SponsorEditDialog
          sponsorId={target.sponsorId}
          open={true}
          onClose={() => setTarget(null)}
          onChange={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
            refreshIframe();
          }}
        />
      )}

      {/* Create-story dialog -- launched from the toolbar's "+ Add story". */}
      <StoryCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
          refreshIframe();
        }}
        defaultCityId={currentCity.id}
      />
    </div>
  );
}

export default function CockpitLivePage() {
  return (
    <AdminCityProvider>
      <CockpitLiveInner />
    </AdminCityProvider>
  );
}
