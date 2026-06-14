import type { Story } from "@shared/schema";
import {
  DESK_META,
  POLITICAL_SCOPE_META,
  type DeskId,
  type PoliticalScope,
  parseTags,
  relativeTime,
  absoluteDate,
  formatEventRange,
} from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { ShareButton } from "./ShareButton";
import { FeedbackBar } from "./FeedbackBar";
import { ExternalLink, Layers, MapPin, Scale } from "lucide-react";

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

const SOURCE_BADGE_STYLE: Record<string, string> = {
  Official: "bg-desk-city/10 text-[hsl(var(--desk-city))] border border-[hsl(var(--desk-city))]/30",
  "Local News":
    "bg-desk-business/10 text-[hsl(var(--desk-business))] border border-[hsl(var(--desk-business))]/30",
  "Community Calendar":
    "bg-desk-entertainment/10 text-[hsl(var(--desk-entertainment))] border border-[hsl(var(--desk-entertainment))]/30",
};

// Display-only relabel: data still stores the long source-type name so the
// admin/ingest pipeline keeps its existing taxonomy, but the public pill is
// shorter and friendlier on small cards. "Community Calendar" reads as
// "Event" -- those rows are always upcoming events, never recurring news.
const SOURCE_BADGE_LABEL: Record<string, string> = {
  "Community Calendar": "Event",
};

export function StoryCard({ story, onOpen }: Props) {
  const tags = parseTags(story.tags);
  const desk = story.desk as DeskId;
  const deskMeta = DESK_META[desk] ?? DESK_META.city;

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

      <div className="flex items-center gap-3 text-muted-foreground">
        <DeskBadge desk={desk} />
        <span className="text-[0.68rem] font-mono uppercase tracking-[0.14em] text-muted-foreground/70">·</span>
        <time
          title={absoluteDate(story.publishedAt)}
          className="text-xs font-mono text-muted-foreground"
          data-testid={`text-time-${story.id}`}
        >
          {relativeTime(story.publishedAt)}
        </time>
        {/* Share button — native Web Share sheet on mobile, copy/email/social
            dropdown on desktop. ms-auto floats it to the right edge of the
            card's top row without disturbing the rest of the layout. */}
        <div className="ms-auto">
          <ShareButton story={story} />
        </div>
        {/* status pill (New / Updated / Event / Developing) intentionally
            removed -- it duplicated the desk color and the bottom-row
            source/event pill on every card. */}
        {false && story.politicalScope && (
          <>
            <span className="text-[0.68rem] font-mono text-muted-foreground/70">·</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-mono uppercase tracking-[0.14em] bg-scope-${story.politicalScope} border-scope-${story.politicalScope}`}
              title={POLITICAL_SCOPE_META[story.politicalScope as PoliticalScope]?.description}
              data-testid={`chip-scope-${story.id}`}
            >
              <Scale className="h-3 w-3" />
              {POLITICAL_SCOPE_META[story.politicalScope as PoliticalScope]?.label ?? story.politicalScope}
            </span>
          </>
        )}
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

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {/* Source-type pill: LOCAL NEWS / OFFICIAL / EVENT */}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.64rem] font-medium uppercase tracking-[0.1em] ${
              SOURCE_BADGE_STYLE[story.sourceType] ?? ""
            }`}
            title={`Source type: ${story.sourceType}`}
          >
            {SOURCE_BADGE_LABEL[story.sourceType] ?? story.sourceType}
          </span>
          {/* Story tags as muted neutral pills, sitting alongside the source
              pill so each card has a single "context bubbles" zone. */}
          {tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[0.62rem] font-mono uppercase tracking-[0.1em] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          <span className="text-xs text-muted-foreground" data-testid={`text-source-${story.id}`}>
            {story.sourceName}
          </span>
          {typeof story.sourceCount === "number" && story.sourceCount > 1 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.64rem] font-medium text-primary"
              title={`Reported by ${story.sourceCount} sources`}
              data-testid={`badge-source-count-${story.id}`}
            >
              <Layers className="h-3 w-3" />
              +{story.sourceCount - 1} {story.sourceCount - 1 === 1 ? "source" : "sources"}
            </span>
          )}
        </div>

        {(story as StoryWithSourceCount).isSynthesis &&
        (story as StoryWithSourceCount).synthesisSources?.length ? (
          // Synthesis card: link rail with each source as a text link to its
          // own article. No logos or pills -- the list IS the credibility cue.
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
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
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid={`link-source-${story.id}`}
          >
            Source
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Phase 24: community feedback bar. Sits at the bottom of every
          card. Quiet by default; counts only appear when nonzero. */}
      <div className="mt-3 flex items-center justify-end border-t border-card-border/50 pt-2">
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
