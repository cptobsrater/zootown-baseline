import type { Source, SourceCategory } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ShieldCheck,
  ExternalLink,
  Building2,
  Newspaper,
  CalendarDays,
  AtSign,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: SourceCategory[] = ["official", "news", "calendars", "social"];

const CATEGORY_META: Record<
  SourceCategory,
  { label: string; blurb: string; Icon: typeof Building2 }
> = {
  official: {
    label: "Official",
    blurb:
      "Government, public agencies, hospitals, university — primary sources. Always link out.",
    Icon: Building2,
  },
  news: {
    label: "News",
    blurb: "Local newsrooms covering your city. We summarize and link to the original article.",
    Icon: Newspaper,
  },
  calendars: {
    label: "Calendars",
    blurb:
      "Community event boards we monitor for upcoming things to do — listings, ticketed events, civic meetings.",
    Icon: CalendarDays,
  },
  social: {
    label: "Social Media",
    blurb:
      "Public X / Facebook accounts of agencies, newsrooms, elected officials, and business leaders. Their words, linked back.",
    Icon: AtSign,
  },
};

export function SourcesDialog({ open, onOpenChange }: Props) {
  const { currentCity } = useCity();
  const citySlug = currentCity.slug;
  const { data } = useQuery<Source[]>({
    queryKey: ["/api/sources", citySlug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sources?city=${citySlug}`);
      return (await res.json()) as Source[];
    },
    enabled: open,
  });
  const sources = data ?? [];
  const grouped = sources.reduce<Record<SourceCategory, Source[]>>(
    (acc, s) => {
      const cat = (s.category as SourceCategory) ?? "official";
      acc[cat] = acc[cat] ? [...acc[cat], s] : [s];
      return acc;
    },
    { official: [], news: [], calendars: [], social: [] },
  );
  const totalShown = sources.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="dialog-sources">
        <div className="h-1.5 w-full bg-primary" />
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="font-serif text-2xl">Sources & About</DialogTitle>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ZooTown is an{" "}
              <strong className="text-foreground font-semibold">
                AI-assisted local aggregator
              </strong>{" "}
              — not a traditional newsroom. We monitor trusted local sources, rewrite
              updates into short feed posts, and always link back to the original. Sensitive topics
              are routed to human review before publishing. Sources are organized into four
              categories below.
            </p>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              {totalShown} sources monitored
            </p>
          </DialogHeader>

          <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-[0.82rem] leading-relaxed text-foreground/90">
            <div className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> Sourcing rules
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <li>· Every post links to the original source</li>
              <li>· Every post shows a source label</li>
              <li>· Sensitive content goes through human review</li>
              <li>· No full-article republication</li>
              <li>· Public &amp; reliable local sources first</li>
              <li>· AI-assisted, not AI-authored reporting</li>
            </ul>
          </div>

          <div className="space-y-6">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat] ?? [];
              if (!items.length) return null;
              const { label, blurb, Icon } = CATEGORY_META[cat];
              return (
                <section key={cat} data-testid={`category-${cat}`}>
                  <header className="mb-2 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-foreground/80" />
                    <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
                      {label}
                    </h3>
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      {items.length}
                    </span>
                  </header>
                  <p className="mb-2 text-xs text-muted-foreground leading-relaxed">{blurb}</p>
                  <ul className="divide-y divide-border rounded-lg border border-card-border bg-card">
                    {items.map((s) => {
                      const handle = s.handle?.startsWith("@") ? s.handle : s.handle ? `@${s.handle}` : null;
                      const platformBadge = s.platform
                        ? s.platform === "x"
                          ? "X"
                          : s.platform.charAt(0).toUpperCase() + s.platform.slice(1)
                        : null;
                      return (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground truncate">
                                {s.name}
                              </span>
                              {platformBadge && (
                                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-1.5 py-px font-mono text-[0.55rem] uppercase tracking-[0.16em] text-muted-foreground">
                                  {platformBadge}
                                </span>
                              )}
                              {handle && (
                                <span className="font-mono text-[0.7rem] text-muted-foreground">
                                  {handle}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground truncate">
                              {s.url}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="hidden sm:inline font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
                              every {s.cadenceMinutes}m
                            </span>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Open ${s.name}`}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
