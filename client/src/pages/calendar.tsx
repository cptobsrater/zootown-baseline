import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { EventItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import { DESK_META, type DeskId } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { Weather } from "@/components/Weather";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
  Grid3x3,
  ExternalLink,
  MapPin,
  X,
  Clock,
} from "lucide-react";
import { useTheme } from "@/lib/theme";

type ViewMode = "month" | "agenda";
type DeskFilter = "all" | DeskId;

// On phones, the month grid is too cramped — default to Agenda which lists events vertically.
function initialViewForViewport(): ViewMode {
  if (typeof window === "undefined") return "month";
  return window.matchMedia("(max-width: 640px)").matches ? "agenda" : "month";
}

const DESK_ORDER: DeskId[] = [
  "city",
  "business",
  "crime",
  "sports",
  "health",
  "entertainment",
  "people",
  "history",
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Build the 6-row grid (42 cells) for a given month — Sunday-first.
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const startDow = first.getDay(); // 0 = Sun
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startDow);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

export default function CalendarPage() {
  const { currentCity } = useCity();
  const citySlug = currentCity.slug;
  // Keep TopBar happy — not actually used for navigation here, but it exists in the shared shell.
  const [, setHomeDesk] = useState<DeskFilter>("all");
  const [query, setQuery] = useState("");
  useTheme(); // ensures provider is present

  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<ViewMode>(initialViewForViewport);
  const [activeDesks, setActiveDesks] = useState<Set<DeskFilter>>(new Set(["all"]));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

  const eventsQuery = useQuery<EventItem[]>({
    queryKey: ["/api/events", { limit: 500, city: citySlug }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events?limit=500&city=${citySlug}`);
      return (await res.json()) as EventItem[];
    },
  });

  const allEvents = eventsQuery.data ?? [];

  // Filter by desk.
  const events = useMemo(() => {
    if (activeDesks.has("all") || activeDesks.size === 0) return allEvents;
    return allEvents.filter((e) => e.desk && activeDesks.has(e.desk as DeskFilter));
  }, [allEvents, activeDesks]);

  // Bucket events by local date for fast day lookups.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const d = new Date(e.startsAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [events]);

  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);

  const today = startOfDay(new Date());
  const monthLabel = formatMonthLabel(anchor);

  // Agenda list: grouped by day, starting today, only days with events, next 90 days.
  const agenda = useMemo(() => {
    const startFrom = startOfDay(new Date());
    const maxDays = 120;
    const end = new Date(startFrom);
    end.setDate(startFrom.getDate() + maxDays);
    const groups: Array<{ day: Date; items: EventItem[] }> = [];
    for (const e of events) {
      const d = startOfDay(new Date(e.startsAt));
      if (d < startFrom || d > end) continue;
      const last = groups[groups.length - 1];
      if (last && sameDay(last.day, d)) last.items.push(e);
      else groups.push({ day: d, items: [e] });
    }
    groups.sort((a, b) => a.day.getTime() - b.day.getTime());
    for (const g of groups) g.items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return groups;
  }, [events]);

  function prevMonth() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
  }
  function nextMonth() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
  }
  function goToday() {
    setAnchor(startOfMonth(new Date()));
    setSelectedDay(startOfDay(new Date()));
  }

  function toggleDesk(id: DeskFilter) {
    setActiveDesks((prev) => {
      const next = new Set(prev);
      if (id === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return new Set(["all"]);
      return next;
    });
  }

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const selectedDayEvents = selectedDay ? eventsByDay.get(dayKey(selectedDay)) ?? [] : [];

  const totalInMonth = useMemo(() => {
    return events.filter((e) => {
      const d = new Date(e.startsAt);
      return d.getFullYear() === anchor.getFullYear() && d.getMonth() === anchor.getMonth();
    }).length;
  }, [events, anchor]);

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        desk="all"
        onDeskChange={(d) => setHomeDesk(d)}
        query={query}
        onQueryChange={setQuery}
        onOpenSources={() => {}}
        lastUpdatedLabel="Calendar"
      />
      <Weather />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              <CalendarIcon className="h-3 w-3" />
              ZooTown calendar
            </div>
            <h1 className="mt-1 font-serif text-[1.85rem] leading-tight font-semibold tracking-tight text-foreground">
              Everything happening in {currentCity.displayName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Elections, civic meetings, arts, sports, volunteer days, and more — pulled from every
              desk into one view.
            </p>
          </div>

          {/* View toggle */}
          <div
            className="inline-flex items-center rounded-md border border-border bg-background p-1"
            role="tablist"
            aria-label="View mode"
          >
            <button
              onClick={() => setView("month")}
              role="tab"
              aria-selected={view === "month"}
              data-testid="tab-view-month"
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "month"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5" />
              Month
            </button>
            <button
              onClick={() => setView("agenda")}
              role="tab"
              aria-selected={view === "agenda"}
              data-testid="tab-view-agenda"
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "agenda"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Agenda
            </button>
          </div>
        </div>

        {/* Desk filter chips */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground mr-1">
            Filter
          </span>
          <button
            onClick={() => toggleDesk("all")}
            data-testid="chip-filter-all"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeDesks.has("all")
                ? "border-foreground/25 bg-foreground text-background"
                : "border-border bg-background text-foreground hover-elevate"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/60" />
            All desks
          </button>
          {DESK_ORDER.map((id) => {
            const active = activeDesks.has(id);
            return (
              <button
                key={id}
                onClick={() => toggleDesk(id)}
                data-testid={`chip-filter-${id}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? `border-desk-${id} bg-desk-${id}`
                    : "border-border bg-background text-foreground hover-elevate"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    active ? "bg-white/80" : `bg-desk-${id}`
                  }`}
                />
                {DESK_META[id]?.short ?? id}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            {events.length} events · {totalInMonth} this month
          </span>
        </div>

        {view === "month" ? (
          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Month grid */}
            <section aria-label="Month grid">
              {/* Month nav */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={prevMonth}
                    data-testid="button-prev-month"
                    aria-label="Previous month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover-elevate"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={nextMonth}
                    data-testid="button-next-month"
                    aria-label="Next month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover-elevate"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={goToday}
                    data-testid="button-today"
                    className="ml-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate"
                  >
                    Today
                  </button>
                </div>
                <h2
                  className="font-serif text-xl font-semibold tracking-tight"
                  data-testid="text-month-label"
                >
                  {monthLabel}
                </h2>
              </div>

              {/* Weekday header */}
              <div className="grid grid-cols-7 overflow-hidden rounded-t-lg border-x border-t border-card-border bg-secondary/30 text-center font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="py-2">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 overflow-hidden rounded-b-lg border border-card-border bg-card">
                {cells.map((cell, i) => {
                  const isCurrentMonth = cell.getMonth() === anchor.getMonth();
                  const isToday = sameDay(cell, today);
                  const isSelected = selectedDay && sameDay(cell, selectedDay);
                  const dayEvents = eventsByDay.get(dayKey(cell)) ?? [];
                  const hasEvents = dayEvents.length > 0;
                  // Up to 3 desk dots (unique), then a "+N" if more.
                  const uniqueDesks = Array.from(
                    new Set(dayEvents.map((e) => e.desk).filter(Boolean)),
                  ) as DeskId[];
                  const shownDesks = uniqueDesks.slice(0, 4);
                  const extraCount = Math.max(0, dayEvents.length - 3);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(cell)}
                      data-testid={`day-cell-${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`}
                      className={`group relative flex min-h-[56px] sm:min-h-[90px] flex-col items-start gap-1 border-b border-r border-card-border p-1 sm:p-2 text-left transition-colors hover-elevate ${
                        i % 7 === 6 ? "border-r-0" : ""
                      } ${i >= 35 ? "border-b-0" : ""} ${
                        isCurrentMonth ? "bg-card" : "bg-background/60"
                      } ${isSelected ? "ring-2 ring-primary/50 ring-inset" : ""}`}
                    >
                      <span
                        className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums ${
                          isToday
                            ? "bg-primary text-primary-foreground"
                            : isCurrentMonth
                            ? "text-foreground"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {cell.getDate()}
                      </span>

                      {/* Event titles: visible on >= sm. Hidden on phones, where the desk dot strip below carries the signal. */}
                      <div className="mt-0.5 w-full space-y-0.5 hidden sm:block">
                        {dayEvents.slice(0, 3).map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center gap-1 truncate text-[0.68rem] leading-snug"
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                e.desk ? `bg-desk-${e.desk}` : "bg-muted-foreground/60"
                              }`}
                            />
                            <span className="truncate text-foreground/85 group-hover:text-foreground">
                              {e.title}
                            </span>
                          </div>
                        ))}
                        {extraCount > 0 && (
                          <div className="text-[0.62rem] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                            +{extraCount} more
                          </div>
                        )}
                      </div>
                      {/* Compact mobile peek: just the event count when there are any */}
                      {hasEvents && (
                        <div className="sm:hidden mt-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                          {dayEvents.length}
                        </div>
                      )}

                      {/* Desk dot strip (bottom) — redundant visual cue */}
                      {hasEvents && (
                        <div className="mt-auto flex items-center gap-0.5 pt-1">
                          {shownDesks.map((d) => (
                            <span
                              key={d}
                              className={`inline-block h-1 w-3 rounded-full bg-desk-${d}`}
                              title={DESK_META[d]?.label ?? d}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Month-level legend */}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.68rem] text-muted-foreground">
                <span className="font-mono uppercase tracking-[0.16em]">Legend</span>
                {DESK_ORDER.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-3 rounded-full bg-desk-${id}`} />
                    {DESK_META[id]?.short ?? id}
                  </span>
                ))}
              </div>
            </section>

            {/* Day drill-down panel — stacks under grid on phones, sticky sidebar on desktop */}
            <aside
              aria-label="Day details"
              className="lg:sticky lg:top-[144px] h-fit rounded-lg border border-card-border bg-card p-4"
              data-testid="panel-day-details"
            >
              {selectedDay ? (
                <>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                        {sameDay(selectedDay, today) ? "Today" : "Selected"}
                      </div>
                      <h3 className="mt-0.5 font-serif text-lg font-semibold tracking-tight">
                        {formatFullDate(selectedDay.toISOString())}
                      </h3>
                    </div>
                    <button
                      onClick={() => setSelectedDay(null)}
                      aria-label="Close day panel"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover-elevate"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {selectedDayEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing scheduled for this day.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedDayEvents.map((e) => (
                        <li key={e.id}>
                          <button
                            onClick={() => setSelectedEvent(e)}
                            data-testid={`button-event-${e.id}`}
                            className="group w-full rounded-md border border-border bg-background p-3 text-left hover-elevate"
                          >
                            <div className="flex items-center gap-2">
                              {e.desk && (
                                <span
                                  className={`inline-block h-2 w-2 rounded-full bg-desk-${e.desk}`}
                                />
                              )}
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
                                {formatTime(e.startsAt)}
                              </span>
                            </div>
                            <div className="mt-1 font-serif text-[0.98rem] font-semibold leading-snug text-foreground group-hover:text-primary">
                              {e.title}
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-[0.72rem] text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {e.venue}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <p className="font-serif text-foreground">Select a day</p>
                  <p className="mt-1">
                    Pick any date on the grid to see that day's events and open a drawer with the
                    source link.
                  </p>
                </div>
              )}
            </aside>
          </div>
        ) : (
          // Agenda view
          <section aria-label="Agenda list">
            {eventsQuery.isLoading ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
                Loading events…
              </div>
            ) : agenda.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
                <p className="font-serif text-lg text-foreground">
                  No upcoming events match these filters.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try clearing filters or switching to Month view.
                </p>
              </div>
            ) : (
              <ul className="space-y-6">
                {agenda.map((group) => (
                  <li key={group.day.toISOString()}>
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="font-serif text-base font-semibold tracking-tight">
                        {formatFullDate(group.day.toISOString())}
                      </h3>
                      <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {group.items.length} {group.items.length === 1 ? "event" : "events"}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {group.items.map((e) => (
                        <li key={e.id}>
                          <button
                            onClick={() => setSelectedEvent(e)}
                            data-testid={`agenda-event-${e.id}`}
                            className="group relative block w-full rounded-lg border border-card-border bg-card p-4 text-left hover-elevate"
                          >
                            {e.desk && (
                              <div
                                className={`absolute left-0 top-4 bottom-4 w-[3px] rounded-r bg-desk-${e.desk}`}
                              />
                            )}
                            <div className="flex items-center gap-3 text-muted-foreground">
                              <span className="inline-flex items-center gap-1 font-mono text-[0.64rem] uppercase tracking-[0.14em]">
                                <Clock className="h-3 w-3" />
                                {formatTime(e.startsAt)}
                              </span>
                              {e.desk && (
                                <>
                                  <span className="text-[0.62rem] font-mono text-muted-foreground/70">
                                    ·
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 font-mono text-[0.64rem] uppercase tracking-[0.14em] desk-${e.desk}`}
                                  >
                                    <span
                                      className={`inline-block h-1.5 w-1.5 rounded-full bg-desk-${e.desk}`}
                                    />
                                    {DESK_META[e.desk as DeskId]?.short ?? e.desk}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-2 font-serif text-[1.08rem] font-semibold leading-snug text-foreground group-hover:text-primary">
                              {e.title}
                            </div>
                            {e.description && (
                              <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                                {e.description}
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-1 text-[0.72rem] text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {e.venue}
                              <span className="mx-1">·</span>
                              <span>{e.sourceName}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="mx-auto mt-16 max-w-[1400px] border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
            <div>
              ZooTown · Calendar · All events link to their original source. We don't resell
              tickets.
            </div>
            <Link
              href={`/${citySlug}`}
              className="font-mono text-[0.62rem] uppercase tracking-[0.18em] hover:text-foreground"
              data-testid="link-back-home"
            >
              ← Back to feed
            </Link>
          </div>
        </footer>
      </main>

      {/* Event drawer */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:justify-end"
          role="dialog"
          aria-modal="true"
          data-testid="drawer-event"
        >
          <div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setSelectedEvent(null)}
          />
          <div className="relative m-0 w-full max-w-lg rounded-t-xl border border-card-border bg-card p-6 shadow-xl sm:m-6 sm:rounded-xl">
            <button
              onClick={() => setSelectedEvent(null)}
              aria-label="Close event"
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover-elevate"
              data-testid="button-close-event"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-muted-foreground">
              {selectedEvent.desk && (
                <span
                  className={`inline-flex items-center gap-1 font-mono text-[0.64rem] uppercase tracking-[0.14em] desk-${selectedEvent.desk}`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full bg-desk-${selectedEvent.desk}`}
                  />
                  {DESK_META[selectedEvent.desk as DeskId]?.label ?? selectedEvent.desk}
                </span>
              )}
            </div>
            <h2 className="mt-2 font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
              {selectedEvent.title}
            </h2>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {formatFullDate(selectedEvent.startsAt)} · {formatTime(selectedEvent.startsAt)}
                {selectedEvent.endsAt && <> – {formatTime(selectedEvent.endsAt)}</>}
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {selectedEvent.venue}
              </div>
            </div>
            {selectedEvent.description && (
              <p className="mt-4 text-sm leading-relaxed text-foreground/85">
                {selectedEvent.description}
              </p>
            )}
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">
                Listed by {selectedEvent.sourceName}
              </span>
              <a
                href={selectedEvent.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2"
                data-testid="link-event-source"
              >
                View source
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
