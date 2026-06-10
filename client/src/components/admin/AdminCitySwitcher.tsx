/**
 * Admin city switcher. Same UI as the public CitySwitcher but it flips
 * internal admin state (via useAdminCity) instead of navigating the URL.
 */
import { useState, useEffect, useRef } from "react";
import { MapPin, ChevronDown, Check } from "lucide-react";
import { useAdminCity } from "@/lib/admin-city-context";

export function AdminCitySwitcher() {
  const { cities, currentCity, setCurrentCitySlug } = useAdminCity();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectCity(slug: string) {
    setOpen(false);
    setCurrentCitySlug(slug);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="button-admin-city-switcher"
        className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-foreground hover-elevate transition-colors"
      >
        <MapPin className="h-3.5 w-3.5" />
        <span>
          Editing: <span className="font-semibold">{currentCity.displayName}</span>
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 z-50 min-w-[220px] rounded-md border border-border bg-popover shadow-lg overflow-hidden"
          data-testid="menu-admin-city-switcher"
        >
          <div className="px-3 py-2 border-b border-border bg-secondary/40">
            <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              Switch editing city
            </div>
          </div>
          <ul className="py-1 max-h-[60vh] overflow-y-auto">
            {cities.map((c) => {
              const isCurrent = c.slug === currentCity.slug;
              return (
                <li key={c.slug}>
                  <button
                    onClick={() => selectCity(c.slug)}
                    data-testid={`admin-city-option-${c.slug}`}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary/60 transition-colors ${
                      isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <span>
                      {c.displayName}
                      <span className="ml-1 text-[0.7rem] text-muted-foreground/70">{c.state}</span>
                    </span>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
