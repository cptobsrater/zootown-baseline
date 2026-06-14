/**
 * Phone-only calendar sheet.
 *
 * Opens as a near-fullscreen overlay from the calendar icon in the mobile top
 * bar. Shows the current month grid where each day cell only displays colored
 * desk-dots/lines (no event text — phones are too narrow for that). Tapping a
 * day reveals an agenda list beneath the grid, sorted chronologically.
 *
 * Category filter chips collapse into a small "Filter" disclosure to keep the
 * grid breathing room. Desktop still uses the existing /:city/calendar page.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import { DESK_META, type DeskId } from "@/lib/format";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  SlidersHorizontal,
  Check,
} from "lucide-react";

type DeskFilter = "all" | DeskId;

const DESK_ORDER: DeskId[] = [
  "city", "business", "crime", "sports", "health",
  "entertainment", "people", "history",
];

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const startDow = first.getDay();
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
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileCalendarSheet({ open, onOpenChange }: Props) {
  const { currentCity } = useCity();
  const citySlug = currentCity.slug;

  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(() => startOfDay(new Date()));
  const [activeDesks, setActiveDesks] = useState<Set<DeskFilter>>(new Set<DeskFilter>(["all"]));
  const [filterOpen, setFilterOpen] = useState(false);

  // Lock body scroll while the sheet is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset to current month every time the user opens the sheet
  useEffect(() => {
    if (open) {
      setAnchor(startOfMonth(new Date()));
      setSelectedDay(startOfDay(new Date()));
    }
  }, [open]);

  const eventsQuery = useQuery<EventItem[]>({
    queryKey: ["/api/events", { limit: 500, city: citySlug }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events?limit=500&city=${citySlug}`);
      return (await res.json()) as EventItem[];
    },
    enabled: open,
  });
  const allEvents = eventsQuery.data ?? [];

  const events = useMemo(() => {
    if (activeDesks.has("all") || activeDesks.size === 0) return allEvents;
    return allEvents.filter((e) => e.desk && activeDesks.has(e.desk as DeskFilter));
  }, [allEvents, activeDesks]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, EventItem[]>();
    for (const e of events) {
      const d = new Date(e.startsAt);
      const k = dayKey(d);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    Array.from(m.values()).forEach((arr: EventItem[]) => arr.sort((a: EventItem, b: EventItem) => a.startsAt.localeCompare(b.startsAt)));
    return m;
  }, [events]);

  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const today = startOfDay(new Date());
  const monthLabel = formatMonthLabel(anchor);
  const selectedDayEvents = selectedDay ? eventsByDay.get(dayKey(selectedDay)) ?? [] : [];

  function toggleDesk(id: DeskFilter) {
    setActiveDesks((prev) => {
      const next = new Set<DeskFilter>(prev);
      if (id === "all") return new Set<DeskFilter>(["all"]);
      next.delete("all");
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return new Set<DeskFilter>(["all"]);
      return next;
    });
  }
  function prevMonth() { setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)); }
  function nextMonth() { setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)); }
  function goToday() {
    setAnchor(startOfMonth(new Date()));
    setSelectedDay(startOfDay(new Date()));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Calendar"
      data-testid="mobile-calendar-sheet"
    >
      {/* Header — month nav + close */}
      <div className="flex items-center justify-between border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            data-testid="mobile-cal-prev"
            aria-label="Previous month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover-elevate"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={nextMonth}
            data-testid="mobile-cal-next"
            aria-label="Next month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover-elevate"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2
          className="font-serif text-lg font-semibold tracking-tight"
          data-testid="mobile-cal-month-label"
        >
          {monthLabel}
        </h2>
        <button
          onClick={() => onOpenChange(false)}
          data-testid="mobile-cal-close"
          aria-label="Close"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover-elevate"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Sub-toolbar: city label · Today · Filter toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 text-xs">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
          {currentCity.displayName}, {currentCity.state} · {events.length} events
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            data-testid="mobile-cal-today"
            className="rounded-md border border-border bg-background px-2.5 py-1 text-[0.7rem] font-medium hover-elevate"
          >
            Today
          </button>
          <button
            onClick={() => setFilterOpen((o) => !o)}
            data-testid="mobile-cal-filter-toggle"
            aria-expanded={filterOpen}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[0.7rem] font-medium hover-elevate ${
              activeDesks.has("all")
                ? "border-border bg-background text-muted-foreground"
                : "border-foreground/30 bg-foreground/5 text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filter
            {!activeDesks.has("all") && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[0.6rem] font-mono text-background tabular-nums">
                {activeDesks.size}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Collapsible filter chips */}
      {filterOpen && (
        <div className="border-b border-border bg-secondary/30 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={activeDesks.has("all")}
              onClick={() => toggleDesk("all")}
              dotClass="bg-foreground/60"
              label="All"
              testId="mobile-cal-chip-all"
            />
            {DESK_ORDER.map((id) => (
              <FilterChip
                key={id}
                active={activeDesks.has(id)}
                onClick={() => toggleDesk(id)}
                dotClass={`bg-desk-${id}`}
                label={DESK_META[id]?.short ?? id}
                testId={`mobile-cal-chip-${id}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Calendar grid — fills available width, square cells */}
      <div className="flex-shrink-0 px-2 pt-2 pb-1">
        {/* Weekday header */}
        <div className="grid grid-cols-7 text-center font-mono text-[0.55rem] uppercase tracking-[0.14em] text-muted-foreground">
          {["S","M","T","W","T","F","S"].map((d, i) => (
            <div key={i} className="py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-[2px]">
          {cells.map((cell, i) => {
            const isCurrentMonth = cell.getMonth() === anchor.getMonth();
            const isToday = sameDay(cell, today);
            const isSelected = selectedDay && sameDay(cell, selectedDay);
            const dayEvents = eventsByDay.get(dayKey(cell)) ?? [];
            const hasEvents = dayEvents.length > 0;
            const uniqueDesks = Array.from(
              new Set(dayEvents.map((e) => e.desk).filter(Boolean)),
            ) as DeskId[];
            const shownDesks = uniqueDesks.slice(0, 4);
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(cell)}
                data-testid={`mobile-cal-cell-${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`}
                className={`relative flex aspect-square min-h-[44px] flex-col items-center justify-start gap-0.5 rounded-md py-1 text-center transition-colors ${
                  !isCurrentMonth ? "opacity-35" : ""
                } ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : isToday
                    ? "bg-secondary text-foreground"
                    : hasEvents
                    ? "bg-card text-foreground hover-elevate"
                    : "text-muted-foreground hover-elevate"
                }`}
              >
                <span className={`text-xs font-medium leading-none tabular-nums ${isSelected ? "text-primary-foreground" : ""}`}>
                  {cell.getDate()}
                </span>
                {/* Colored desk dots: up to 4, then a "+N" */}
                {hasEvents && (
                  <div className="mt-auto flex h-1.5 items-center justify-center gap-0.5">
                    {shownDesks.map((d) => (
                      <span
                        key={d}
                        className={`inline-block h-1 w-1 rounded-full bg-desk-${d}`}
                        title={DESK_META[d]?.label ?? d}
                      />
                    ))}
                    {uniqueDesks.length > 4 && (
                      <span className="text-[0.55rem] font-mono leading-none text-muted-foreground">+</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Agenda for the selected day */}
      <div className="flex-1 overflow-y-auto border-t border-border bg-background/60 px-3 pb-6 pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-base font-semibold tracking-tight">
            {selectedDay ? formatFullDate(selectedDay.toISOString()) : "Pick a day"}
          </h3>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
            {selectedDayEvents.length} {selectedDayEvents.length === 1 ? "event" : "events"}
          </span>
        </div>

        {eventsQuery.isLoading && (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        )}

        {!eventsQuery.isLoading && selectedDayEvents.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center">
            <p className="font-serif text-sm text-foreground">Nothing scheduled.</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another day, or tap Filter to broaden the view.</p>
          </div>
        )}

        <ul className="space-y-2">
          {selectedDayEvents.map((e) => (
            <li key={e.id}>
              <a
                href={e.primaryLink ?? e.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`mobile-cal-agenda-${e.id}`}
                className="group relative block rounded-lg border border-card-border bg-card p-3 text-left hover-elevate"
              >
                {e.desk && (
                  <span
                    aria-hidden
                    className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-desk-${e.desk}`}
                  />
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em]">
                    {formatTime(e.startsAt)}
                  </span>
                  {e.desk && (
                    <>
                      <span className="text-muted-foreground/60">·</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[0.62rem] uppercase tracking-[0.14em]">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full bg-desk-${e.desk}`} />
                        {DESK_META[e.desk as DeskId]?.short ?? e.desk}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-1 font-serif text-[1rem] font-semibold leading-snug text-foreground group-hover:text-primary">
                  {e.title}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[0.72rem] text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{e.venue}</span>
                  <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  dotClass,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  dotClass: string;
  label: string;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
        active
          ? "border-foreground/30 bg-foreground text-background"
          : "border-border bg-background text-foreground hover-elevate"
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-background/80" : dotClass}`} />
      {label}
      {active && <Check className="h-3 w-3" />}
    </button>
  );
}
