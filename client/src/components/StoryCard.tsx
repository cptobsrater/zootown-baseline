import type { Story } from "@shared/schema";
import {
  DESK_META,
  type DeskId,
  relativeTime,
  absoluteDate,
  formatEventRange,
} from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { ShareButton } from "./ShareButton";
import { FeedbackBar } from "./FeedbackBar";
import { ExternalLink, MapPin, Calendar } from "lucide-react";

export type StoryWithSourceCount = Story & {
  sourceCount?: number;
  // Synthesis stories carry the list of original sources here so the card
  // can render "Sources: KPAX · Missoulian · MTPR" as text links.
  synthesisSources?: { sourceName: string; sourceUrl: string }[];
};

interface Props {
  story: StoryWithSourceCount;
  onOpen: (s: Story) => void;
}

export function StoryCard({ story, onOpen }: Props) {
  const desk = story.desk as DeskId;
  const deskMeta = DESK_META[desk] ?? DESK_META.city;
  // An "Event" marker on the top line whenever the story is a future-dated
  // calendar event. Lives between the desk badge and the posted-time,
  // replacing the old bottom-row source-type pill (Cody feedback, Phase 24).
  const isUpcomingEvent = !!(story.onCalendar && story.startsAt);

  return (
    <article
      onClick={() => onOpen(story)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(story);
        }
      }}
      role="button"
      tabIndex={0}
      data-testid={`card-story-${story.id}`}
      className="group relative cursor-pointer border border-card-border bg-card rounded-lg p-5 hover-elevate transition-shadow"
    >
      {/* Desk stripe */}
      <div className={`absolute left-0 top-5 bottom-5 w-[3px] rounded-r bg-desk-${desk}`} />

      {/* Top line: desk badge · (Event chip if upcoming) · posted-time.
          Share button right-aligned. Tag pills and source-type pills
          were removed in Phase 24 to keep the card scannable. */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <DeskBadge desk={desk} />
        {isUpcomingEvent && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border border-[hsl(var(--desk-${desk}))]/40 bg-[hsl(var(--desk-${desk}))]/10 px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.14em] text-[hsl(var(--desk-${desk}))]`}
            title={`Upcoming event: ${formatEventRange(story.startsAt!, story.endsAt)}`}
            data-testid={`chip-event-${story.id}`}
          >
            <Calendar className="h-3 w-3" />
            Event
          </span>
        )}
        <span className="text-[0.68rem] font-mono uppercase tracking-[0.14em] text-muted-foreground/70">·</span>
        <time
          title={absoluteDate(story.publishedAt)}
          className="text-xs font-mono text-muted-foreground"
          data-testid={`text-time-${story.id}`}
        >
          {relativeTime(story.publishedAt)}
        </time>
        <div className="ms-auto">
          <ShareButton story={story} />
        </div>
      </div>

      <h3
        className="mt-3 font-serif text-[1.18rem] leading-snug font-semibold text-foreground group-hover:text-primary transition-colors"
        data-testid={`text-headline-${story.id}`}
      >
        {/*
          For any calendar event (any desk) with a real startsAt, prefix the
          headline with "Mon, Jun 22, 3:00 PM —" so the reader sees WHEN the
          event happens, not when the story was published. Colored to match
          the row's own desk so it stays visually grouped with the badge.
        */}
        {story.onCalendar && story.startsAt && (
          <span
            className={`mr-1 font-mono text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[hsl(var(--desk-${desk}))]`}
          >
            {formatEventRange(story.startsAt, story.endsAt)} —{" "}
          </span>
        )}
        {story.headline}
      </h3>

      <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground line-clamp-3">
        {story.summary}
      </p>

      {story.location && (
        <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {story.location}
        </div>
      )}

      {/* Bottom line: source link left, community feedback buttons right.
          One row, no pills. Synthesis stories show their multi-source rail
          in place of the single source link (the list IS the credibility
          cue). */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        {(story as StoryWithSourceCount).isSynthesis &&
        (story as StoryWithSourceCount).synthesisSources?.length ? (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground min-w-0"
            data-testid={`synthesis-sources-${story.id}`}
          >
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em]">
              Sources:
            </span>
            {(story as StoryWithSourceCount).synthesisSources!.map((src, i) => (
              <span key={src.sourceUrl + i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="opacity-50">·</span>}
                <a
                  href={src.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-foreground hover:underline"
                >
                  {src.sourceName}
                </a>
              </span>
            ))}
          </div>
        ) : (
          <a
            href={story.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
            data-testid={`link-source-${story.id}`}
          >
            <span className="truncate">{story.sourceName}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        )}

        {/* Phase 24: community feedback buttons. Right-aligned, inline with
            the source link. Quiet by default; counts only render when nonzero. */}
        <FeedbackBar storyId={story.id} citySlug={(story as any).citySlug ?? undefined} />
      </div>

      <span className="sr-only">{deskMeta.label}</span>
    </article>
  );
}

export function StoryCardSkeleton() {
  return (
    <div className="relative border border-card-border bg-card rounded-lg p-5 animate-pulse">
      <div className="absolute left-0 top-5 bottom-5 w-[3px] bg-muted rounded-r" />
      <div className="flex items-center gap-3">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-10 rounded bg-muted" />
      </div>
      <div className="mt-3 h-5 w-5/6 rounded bg-muted" />
      <div className="mt-2 h-4 w-full rounded bg-muted" />
      <div className="mt-2 h-4 w-4/6 rounded bg-muted" />
      <div className="mt-4 flex gap-2">
        <div className="h-3 w-12 rounded bg-muted" />
        <div className="h-3 w-14 rounded bg-muted" />
      </div>
    </div>
  );
}
