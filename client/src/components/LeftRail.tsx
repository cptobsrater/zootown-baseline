import { DESK_META, type DeskId } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

interface Props {
  desk: "all" | DeskId;
  onSelect: (d: "all" | DeskId) => void;
  counts?: Partial<Record<"all" | DeskId, number>>;
}

const DESK_ORDER: Array<"all" | DeskId> = [
  "all",
  "city",
  "business",
  "crime",
  "sports",
  "health",
  "entertainment",
  "people",
  "history",
];

function deskMeta(id: "all" | DeskId) {
  if (id === "all") {
    return {
      label: "All desks",
      description: "Everything Missoula — civic, business, sports, safety, events, people, and history.",
      dot: "bg-foreground",
      text: "text-foreground",
      letter: "•",
    };
  }
  const m = DESK_META[id];
  return {
    label: m.label,
    description: m.description,
    dot: `bg-desk-${id}`,
    text: `desk-${id}`,
    letter: m.letter,
  };
}

export function LeftRail({ desk, onSelect, counts = {} }: Props) {
  return (
    <aside
      aria-label="Desk filters"
      className="space-y-6"
      data-testid="left-rail"
    >
      <section className="rounded-lg border border-card-border bg-card p-4">
        <h2 className="font-mono text-[0.64rem] uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">
          Desks
        </h2>
        <ul className="space-y-1">
          {DESK_ORDER.map((id) => {
            const m = deskMeta(id);
            const active = desk === id;
            return (
              <li key={id}>
                <button
                  onClick={() => onSelect(id)}
                  aria-pressed={active}
                  data-testid={`button-filter-${id}`}
                  className={`group relative w-full rounded-md border px-3 py-2.5 text-left transition-colors hover-elevate ${
                    active
                      ? "border-foreground/15 bg-secondary/60"
                      : "border-transparent bg-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                    <span className={`text-sm font-medium ${active ? "text-foreground" : "text-foreground/85"}`}>
                      {m.label}
                    </span>
                    {typeof counts[id] === "number" && (
                      <span className="ml-auto font-mono text-[0.64rem] tabular-nums text-muted-foreground">
                        {counts[id]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 pl-[18px] text-[0.72rem] leading-snug text-muted-foreground">
                    {m.description}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-card-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2 text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
          <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em]">
            How ZooTown works
          </h2>
        </div>
        <ul className="space-y-2 text-[0.78rem] leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground font-medium">Aggregate, don't republish.</span> We read
            trusted local sources and write short summaries.
          </li>
          <li>
            <span className="text-foreground font-medium">Always link back.</span> Every post points
            to the original reporter or office.
          </li>
          <li>
            <span className="text-foreground font-medium">Politics stays neutral.</span> Candidates
            in their own words or a link to their site — no editorial framing.
          </li>
        </ul>
      </section>
    </aside>
  );
}
