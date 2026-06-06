import { DESK_META, type DeskId } from "@/lib/format";

export function DeskBadge({
  desk,
  size = "sm",
}: {
  desk: DeskId;
  size?: "sm" | "md";
}) {
  const m = DESK_META[desk] ?? { short: desk, letter: "?" };
  const dot = `bg-desk-${desk}`;
  const text = `desk-${desk}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] ${
        size === "md" ? "text-[0.72rem]" : "text-[0.64rem]"
      }`}
      data-testid={`badge-desk-${desk}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className={text}>{m.short}</span>
    </span>
  );
}
