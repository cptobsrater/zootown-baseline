import { useState } from "react";
import type { Story } from "@shared/schema";
import { Share2, Link as LinkIcon, Mail, MessageSquare, Check } from "lucide-react";
import { useCity } from "@/lib/city-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  story: Story;
}

/**
 * Share button shown on every story card.
 *
 * On devices that support the Web Share API (most mobile browsers + recent
 * Safari/Chrome on macOS) the button invokes the native share sheet directly,
 * so the user gets the system-level options (Messages, AirDrop, WhatsApp,
 * Slack, etc.).
 *
 * Everywhere else (most desktops, Firefox) the button opens a dropdown menu
 * with explicit Copy / Email / X / Facebook options so the user is never
 * stranded.
 *
 * The share URL is the deep link to the story inside ZooTown
 * (/:city/story/:id), NOT the original source URL. That way the recipient
 * lands in ZooTown's reader where they can also see the original source link.
 */
export function ShareButton({ story }: Props) {
  const { currentCity } = useCity();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/${currentCity.slug}/story/${story.id}`
      : `/${currentCity.slug}/story/${story.id}`;
  const shareTitle = story.headline;
  const shareText = story.summary ? story.summary.slice(0, 200) : story.headline;

  // Detect Web Share API. We use `canShare` as the strict check because some
  // desktop browsers expose `share` but throw on actual invocation.
  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (navigator as any).canShare?.({ title: shareTitle, text: shareText, url }) !== false;

  // Stop card-click propagation: the card itself opens the drawer, but
  // clicking the share button should NOT open the drawer.
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
  };

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers without Clipboard API access
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function handleNativeShare(e: React.MouseEvent) {
    stop(e);
    try {
      await navigator.share({ title: shareTitle, text: shareText, url });
    } catch {
      // AbortError when the user dismisses the sheet -- not an error.
    }
  }

  // ---- Desktop dropdown (no native share) ----
  // sms: uses tel-style URI; on macOS/iOS this opens Messages, on Android
  // it opens the default SMS app. On desktop without phone integration it
  // simply does nothing or prompts to associate an app, which is harmless.
  const mailto = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareText}\n\n${url}`)}`;
  const sms = `sms:?&body=${encodeURIComponent(`${shareTitle}\n${url}`)}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(url)}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  // If native share is available we use it directly: one tap = native sheet.
  if (canNativeShare) {
    return (
      <button
        type="button"
        onClick={handleNativeShare}
        aria-label={`Share "${story.headline}"`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover-elevate"
        data-testid={`button-share-${story.id}`}
      >
        <Share2 className="h-4 w-4" />
      </button>
    );
  }

  // Desktop / fallback: dropdown menu.
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={stop}
          aria-label={`Share "${story.headline}"`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover-elevate"
          data-testid={`button-share-${story.id}`}
        >
          <Share2 className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop} className="w-48">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            copyLink();
          }}
        >
          {copied ? (
            <Check className="mr-2 h-4 w-4 text-emerald-500" />
          ) : (
            <LinkIcon className="mr-2 h-4 w-4" />
          )}
          {copied ? "Link copied" : "Copy link"}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={mailto} target="_blank" rel="noopener noreferrer">
            <Mail className="mr-2 h-4 w-4" />
            Email
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={sms}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Text message
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={xUrl} target="_blank" rel="noopener noreferrer">
            <span className="mr-2 inline-flex h-4 w-4 items-center justify-center font-bold">𝕏</span>
            Share on X
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={fbUrl} target="_blank" rel="noopener noreferrer">
            <span className="mr-2 inline-flex h-4 w-4 items-center justify-center font-bold">f</span>
            Share on Facebook
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
