import { useQuery } from "@tanstack/react-query";
import type { Story } from "@shared/schema";
import { type DeskId, relativeTime } from "@/lib/format";
import { DeskBadge } from "./DeskBadge";
import { apiRequest } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";

interface Props {
  onOpenStory: (s: Story) => void;
}

/**
 * Right rail. Currently shows only "Top stories" \u2014 the trending-tags and
 * source-snapshot panels were removed in the Phase 24 design pass since
 * the same affordances live in the top nav (Sources & About) and we
 * stopped surfacing tags on cards anyway. The empty space is intentional;
 * Phase 25 may bring a new right-rail block once we know what the
 * community actually wants there.
 */
export function RightRail({ onOpenStory }: Props) {
  const { currentCity } = useCity();
  const citySlug = currentCity.slug;
  const top = useQuery<Story[]>({
    queryKey: ["/api/top-stories", citySlug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/top-stories?city=${citySlug}`);
      return (await res.json()) as Story[];
    },
  });

  return (
    <aside className="space-y-6" aria-label="Right rail">
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
    </aside>
  );
}
