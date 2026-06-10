/**
 * "Get App" panel for the landing page.
 *
 * ZooTown is a PWA — there's no App Store binary. Instead, the user installs
 * the website to their home screen, which the OS treats like a native app
 * (full-screen, own icon, no browser chrome).
 *
 * This component walks the user through the install steps for their platform.
 * iOS uses Safari + Share sheet; Android uses Chrome's install prompt;
 * Windows/Desktop uses the install icon in the Chrome/Edge address bar.
 *
 * On Android/Chrome we also capture the `beforeinstallprompt` event so we can
 * trigger a real install dialog with one tap.
 */
import { useEffect, useState } from "react";
import {
  Smartphone,
  Monitor,
  Share2,
  Plus,
  MoreVertical,
  Apple,
  Download,
  ChevronDown,
  Check,
} from "lucide-react";

type Platform = "ios" | "android" | "desktop";

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "ios";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  // iPadOS 13+ reports as Mac; detect by touch
  if (/macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function GetApp() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("ios");
  const [installPrompt, setInstallPrompt] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    // Capture Chrome/Edge install prompt
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as PromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Detect if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function triggerInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  if (installed) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 text-center">
        <div className="inline-flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          App installed
        </div>
        <p className="mt-1 text-sm text-foreground">
          You're running ZooTown as an app — nice.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          data-testid="button-get-app"
          className="group mx-auto flex items-center gap-2.5 rounded-full border border-border bg-card px-5 py-3 text-sm font-medium text-foreground shadow-sm hover-elevate active-elevate-2"
        >
          <Download className="h-4 w-4" />
          Get the app
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
        </button>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-5 md:p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                <Download className="h-3 w-3" />
                Install ZooTown
              </div>
              <h2 className="mt-1 font-serif text-xl font-semibold leading-tight text-foreground">
                Add ZooTown to your home screen
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No App Store needed. ZooTown installs straight from your browser and opens like a regular app.
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover-elevate"
            >
              <ChevronDown className="h-4 w-4 rotate-180" />
            </button>
          </div>

          {/* Platform tabs */}
          <div className="mt-5 inline-flex w-full overflow-x-auto rounded-lg border border-border bg-background p-1 text-xs">
            <PlatformTab
              active={platform === "ios"}
              onClick={() => setPlatform("ios")}
              icon={<Apple className="h-3.5 w-3.5" />}
              label="iPhone / iPad"
            />
            <PlatformTab
              active={platform === "android"}
              onClick={() => setPlatform("android")}
              icon={<Smartphone className="h-3.5 w-3.5" />}
              label="Android"
            />
            <PlatformTab
              active={platform === "desktop"}
              onClick={() => setPlatform("desktop")}
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="Windows / Mac"
            />
          </div>

          {/* Instructions per platform */}
          <div className="mt-5">
            {platform === "ios" && <IosSteps />}
            {platform === "android" && (
              <AndroidSteps installPrompt={installPrompt} onInstall={triggerInstall} />
            )}
            {platform === "desktop" && (
              <DesktopSteps installPrompt={installPrompt} onInstall={triggerInstall} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`tab-platform-${label.toLowerCase().split(" ")[0]}`}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.7rem] font-mono font-semibold text-background tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {children && <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{children}</div>}
      </div>
    </li>
  );
}

function IosSteps() {
  return (
    <ol className="space-y-3">
      <Step n={1} title="Open this site in Safari">
        ZooTown must be installed from Safari on iOS — Chrome and other browsers can't install apps to the home screen.
      </Step>
      <Step n={2} title="Tap the Share button">
        <span className="inline-flex items-center gap-1">
          Look for the <Share2 className="inline h-3.5 w-3.5" /> square-with-arrow icon at the bottom of the screen (or top, on iPad).
        </span>
      </Step>
      <Step n={3} title="Scroll down and tap 'Add to Home Screen'">
        <span className="inline-flex items-center gap-1">
          Look for <Plus className="inline h-3.5 w-3.5" /> Add to Home Screen — usually a few rows into the share sheet.
        </span>
      </Step>
      <Step n={4} title="Tap 'Add' in the top-right corner">
        You can rename it first if you want. ZooTown will appear on your home screen with its own icon.
      </Step>
    </ol>
  );
}

function AndroidSteps({
  installPrompt,
  onInstall,
}: {
  installPrompt: PromptEvent | null;
  onInstall: () => void;
}) {
  return (
    <div className="space-y-4">
      {installPrompt && (
        <button
          onClick={onInstall}
          data-testid="button-android-install"
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover-elevate active-elevate-2"
        >
          Install ZooTown
        </button>
      )}
      <ol className="space-y-3">
        <Step n={1} title="Open this site in Chrome">
          ZooTown installs cleanest through Chrome. Samsung Internet and Edge work too, with similar steps.
        </Step>
        <Step n={2} title="Tap the menu button">
          <span className="inline-flex items-center gap-1">
            Tap the <MoreVertical className="inline h-3.5 w-3.5" /> three-dot menu in the top right of Chrome.
          </span>
        </Step>
        <Step n={3} title="Tap 'Install app' or 'Add to Home screen'">
          Wording varies by Android version and Chrome build. Either choice installs ZooTown.
        </Step>
        <Step n={4} title="Confirm 'Install'">
          The icon lands on your home screen and in your app drawer. Opening it launches ZooTown in full-screen mode.
        </Step>
      </ol>
      {!installPrompt && (
        <p className="rounded-md border border-dashed border-border bg-background/60 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
          Tip: if you don't see "Install app", make sure you opened zootownhub.com directly in Chrome (not inside Facebook, Instagram, or another in-app browser).
        </p>
      )}
    </div>
  );
}

function DesktopSteps({
  installPrompt,
  onInstall,
}: {
  installPrompt: PromptEvent | null;
  onInstall: () => void;
}) {
  return (
    <div className="space-y-4">
      {installPrompt && (
        <button
          onClick={onInstall}
          data-testid="button-desktop-install"
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover-elevate active-elevate-2"
        >
          Install ZooTown
        </button>
      )}
      <ol className="space-y-3">
        <Step n={1} title="Use Chrome, Edge, or Brave on Windows or Mac">
          Safari on macOS supports this too in newer versions ("File → Add to Dock"). Firefox does not currently support PWA install on desktop.
        </Step>
        <Step n={2} title="Look for the install icon in the address bar">
          <span className="inline-flex items-center gap-1">
            A small <Download className="inline h-3.5 w-3.5" /> install icon appears at the right end of the URL bar when a site is installable.
          </span>
        </Step>
        <Step n={3} title="Click 'Install'">
          ZooTown opens in its own window — no browser tabs, no address bar — and gets a shortcut in your Start menu (Windows) or Applications (Mac).
        </Step>
        <Step n={4} title="Pin it to your taskbar or Dock (optional)">
          Right-click the icon while ZooTown is open and choose "Pin to taskbar" or keep it in the Dock.
        </Step>
      </ol>
      {!installPrompt && (
        <p className="rounded-md border border-dashed border-border bg-background/60 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
          Tip: if the install icon doesn't appear yet, reload the page once. The browser needs a moment to register ZooTown as installable.
        </p>
      )}
    </div>
  );
}
