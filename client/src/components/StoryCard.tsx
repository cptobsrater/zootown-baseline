import type { Story } from "@shared/schema";
import {
  DESK_META,
  POLITICAL_SCOPE_META,
  type DeskId,
  type PoliticalScope,
  parseTags,
  relativeTime,
  absoluteDate,
  formatEventDate,
} from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { ExternalLink, Layers, MapPin, Scale } from "lucide-react";

export type StoryWithSourceCount = Story & { sourceCount?: number };

interface Props {
  story: StoryWithSourceCount;
  onOpen: (s: Story) => void;
}

const SOURCE_BADGE_STYLE: Record<string, string> = {
  Official: "bg-desk-city/10 text-[hsl(var(--desk-city))] border border-[hsl(var(--desk-city))]/30",
  "Local News":
    "bg-desk-business/10 text-[hsl(var(--desk-business))] border border-[hsl(var(--desk-business))]/30",
  "Community Calendar":
    "bg-desk-events/10 text-[hsl(var(--desk-events))] border border-[hsl(var(--desk-events))]/30",
};

const STATUS_STYLE: Record<string, string> = {
  New: "bg-primary/12 text-primary border border-primary/25",
  Updated: "bg-foreground/8 text-foreground border border-foreground/15",
  Event: "bg-[hsl(var(--desk-events))]/12 text-[hsl(var(--desk-events))] border border-[hsl(var(--desk-events))]/30",
  Developing: "bg-destructive/12 text-destructive border border-destructive/25",
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
        {story.status && (
          <>
            <span className="text-[0.68rem] font-mono text-muted-foreground/70">·</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.64rem] font-medium ${
                STATUS_STYLE[story.status] ?? ""
              }`}
            >
              {story.status}
            </span>
          </>
        )}
        {desk === "politics" && story.politicalScope && (
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
        {story.desk === "events" && (story as any).eventDate && (
          <span className="mr-1 font-mono text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[hsl(var(--desk-events))]">
            {formatEventDate((story as any).eventDate)} —{" "}
          </span>
        )}
        {story.headline}
      </h3>

      <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground line-clamp-3">
        {story.summary}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {story.location && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {story.location}
          </span>
        )}
        {tags.slice(0, 3).map((t) => (
          <span
            key={t}
            className="text-[0.68rem] font-mono uppercase tracking-[0.14em] text-muted-foreground/80"
          >
            #{t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.64rem] font-medium uppercase tracking-[0.1em] ${
              SOURCE_BADGE_STYLE[story.sourceType] ?? ""
            }`}
            title={`Source type: ${story.sourceType}`}
          >
            {story.sourceType}
          </span>
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
