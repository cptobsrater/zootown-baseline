import type { Story, StorySource } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DESK_META, type DeskId, parseTags, absoluteDate, relativeTime, formatEventRange } from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { ExternalLink, MapPin, Clock, ShieldCheck, Layers, BookOpen } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";

interface Props {
  story: Story | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  related?: Story[];
  onOpenRelated?: (s: Story) => void;
}

interface StoryDetail extends Story {
  sources?: StorySource[];
}

export function StoryDrawer({ story, open, onOpenChange, related = [], onOpenRelated }: Props) {
  const { data: detail } = useQuery<StoryDetail>({
    queryKey: ["/api/stories", story?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stories/${story!.id}`);
      return (await res.json()) as StoryDetail;
    },
    enabled: !!story && open,
  });

  if (!story) return null;
  const tags = parseTags(story.tags);
  const desk = story.desk as DeskId;
  const deskMeta = DESK_META[desk];
  const attachedSources = detail?.sources ?? [];
  const extraSources = attachedSources.filter((s) => s.sourceUrl !== story.sourceUrl);
  const isLongForm = Boolean((story as Story & { body?: string }).body);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
        data-testid="drawer-story"
      >
        {/* Header strip */}
        <div
          className={`h-1.5 w-full ${
            desk === "city"
              ? "bg-desk-city"
              : desk === "business"
              ? "bg-desk-business"
              : "bg-desk-culture"
          }`}
        />
        <SheetHeader className="px-6 pt-6 pb-2 text-left space-y-3">
          <div className="flex items-center gap-3">
            <DeskBadge desk={desk} size="md" />
            <span className="text-[0.64rem] font-mono text-muted-foreground">·</span>
            {/*
              Calendar events get their START time in the chip (matching the
              calendar grid + the public expectation for "event"). Everything
              else falls back to the "posted N min ago" relative-time chip.
            */}
            {story.onCalendar && story.startsAt ? (
              <time
                title={absoluteDate(story.startsAt)}
                className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground"
              >
                <Clock className="h-3 w-3" />
                {formatEventRange(story.startsAt, story.endsAt)}
              </time>
            ) : (
              <time
                title={absoluteDate(story.publishedAt)}
                className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground"
              >
                <Clock className="h-3 w-3" />
                {relativeTime(story.publishedAt)}
              </time>
            )}
            {/* Status pill (Event/New/Updated/Developing) removed: the meta
                line + the bottom-row source pill already convey that. */}
          </div>
          <h2 className="font-serif text-[1.7rem] leading-tight font-semibold text-foreground">
            {story.headline}
          </h2>
          {story.onCalendar && story.startsAt ? (
            <p className="text-xs text-muted-foreground">
              {deskMeta.label} · Starts {formatEventRange(story.startsAt, story.endsAt)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {deskMeta.label} · Published {absoluteDate(story.publishedAt)}
            </p>
          )}
        </SheetHeader>

        <div className="px-6 pb-10 pt-2 space-y-6">
          {(story as Story & { body?: string }).body ? (
            <article className="prose-zootown">
              {renderMarkdown((story as Story & { body?: string }).body!)}
            </article>
          ) : (
            <p className="text-[0.98rem] leading-relaxed text-foreground/90">{story.summary}</p>
          )}

          {story.whyItMatters && (
            <div className="rounded-lg border-l-2 border-primary bg-primary/5 px-4 py-3">
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-primary mb-1">
                Why this matters
              </div>
              <p className="text-[0.95rem] leading-relaxed text-foreground/90">
                {story.whyItMatters}
              </p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-5">
            {story.location && (
              <div>
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                  Location
                </div>
                <div className="inline-flex items-center gap-1.5 text-sm text-foreground">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {story.location}
                </div>
              </div>
            )}
            <div>
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Source type
              </div>
              <div className="text-sm text-foreground">{story.sourceType}</div>
            </div>
          </div>

          {tags.length > 0 && (
            <div>
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Tags
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[0.72rem] text-muted-foreground"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source attribution block */}
          <div className="rounded-lg border border-card-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                  {isLongForm
                    ? "Reference source"
                    : extraSources.length > 0
                    ? "Primary source"
                    : "Original source"}
                </div>
                <div className="text-sm font-medium text-foreground">{story.sourceName}</div>
                <div className="mt-1 text-xs text-muted-foreground break-all">{story.sourceUrl}</div>
              </div>
              <a
                href={story.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2"
                data-testid="link-read-original"
              >
                {isLongForm ? (<><BookOpen className="h-3.5 w-3.5" />Reference</>) : (<>Read original<ExternalLink className="h-3.5 w-3.5" /></>)}
              </a>
            </div>

            {extraSources.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  Also reported by
                </div>
                <ul className="space-y-1.5">
                  {extraSources.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">{s.sourceName}</div>
                        <div className="truncate text-[0.68rem] text-muted-foreground">{s.sourceUrl}</div>
                      </div>
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[0.7rem] text-muted-foreground hover-elevate"
                        data-testid={`link-extra-source-${s.id}`}
                      >
                        Read
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[0.7rem] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>
                ZooTown summarizes trusted local sources. We link back — we never republish.
              </span>
            </div>
          </div>

          {related.length > 0 && (
            <div>
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Related local updates
              </div>
              <ul className="space-y-2">
                {related.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => onOpenRelated?.(r)}
                      className="block w-full text-left rounded-md border border-card-border bg-card px-3 py-2 hover-elevate"
                      data-testid={`link-related-${r.id}`}
                    >
                      <div className="flex items-center gap-2 text-[0.64rem] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-0.5">
                        <DeskBadge desk={r.desk as DeskId} />
                        <span>·</span>
                        <span>{relativeTime(r.publishedAt)}</span>
                      </div>
                      <div className="text-sm text-foreground font-medium leading-snug line-clamp-2">
                        {r.headline}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
