import { useQuery } from "@tanstack/react-query";
import type { Story, Source } from "@shared/schema";
import { type DeskId, relativeTime } from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { Tag, Radio } from "lucide-react";

interface Props {
  onOpenStory: (s: Story) => void;
  onSelectTag: (tag: string) => void;
  onOpenSources: () => void;
}

export function RightRail({ onOpenStory, onSelectTag, onOpenSources }: Props) {
  const top = useQuery<Story[]>({ queryKey: ["/api/top-stories"] });
  const tags = useQuery<Array<{ tag: string; count: number }>>({
    queryKey: ["/api/trending-tags"],
  });
  const sources = useQuery<Source[]>({ queryKey: ["/api/sources"] });

  return (
    <aside className="space-y-6" aria-label="Right rail">
      {/* Top this week */}
      <section
        aria-labelledby="rr-top"
        className="rounded-lg border border-card-border bg-card p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            id="rr-top"
            className="font-mono text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground"
          >
            Top stories
          </h2>
        </div>
        <ol className="space-y-3">
          {(top.data ?? []).map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => onOpenStory(s)}
                className="w-full text-left rounded-md px-1 py-1 hover-elevate"
                data-testid={`button-top-${s.id}`}
              >
                <div className="flex items-start gap-3">
                  <span className="font-serif text-[1.5rem] leading-none font-semibold text-muted-foreground/40 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <DeskBadge desk={s.desk as DeskId} />
                    </div>
                    <h3 className="mt-1 font-serif text-[0.98rem] leading-snug font-semibold text-foreground line-clamp-2">
                      {s.headline}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{relativeTime(s.publishedAt)}</p>
                  </div>
                </div>
              </button>
            </li>
          ))}
          {top.isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="animate-pulse">
                <div className="flex gap-3">
                  <div className="h-6 w-6 rounded bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-12 rounded bg-muted" />
                    <div className="h-4 w-full rounded bg-muted" />
                  </div>
                </div>
              </li>
            ))}
        </ol>
      </section>

      {/* Trending tags */}
      <section
        aria-labelledby="rr-tags"
        className="rounded-lg border border-card-border bg-card p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          <h2
            id="rr-tags"
            className="font-mono text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground"
          >
            Trending tags
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {(tags.data ?? []).map((t) => (
            <button
              key={t.tag}
              onClick={() => onSelectTag(t.tag)}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[0.76rem] text-foreground hover-elevate"
              data-testid={`button-tag-${t.tag}`}
            >
              <span className="text-muted-foreground group-hover:text-foreground">#{t.tag}</span>
              <span className="font-mono text-[0.64rem] text-muted-foreground tabular-nums">
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Source snapshot */}
      <section
        aria-labelledby="rr-sources"
        className="rounded-lg border border-card-border bg-card p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Radio className="h-3.5 w-3.5 text-muted-foreground" />
          <h2
            id="rr-sources"
            className="font-mono text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground"
          >
            Source snapshot
          </h2>
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          Monitoring <span className="text-foreground font-medium">{sources.data?.length ?? 0}</span>{" "}
          Missoula sources across local news, official civic channels, and community calendars.
        </div>
        <button
          onClick={onOpenSources}
          className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover-elevate active-elevate-2"
          data-testid="button-open-sources"
        >
          View all sources
        </button>
      </section>
    </aside>
  );
}
