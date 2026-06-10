/**
 * Click-to-open city dropdown that replaces the static "MISSOULA · MT" pill in the top bar.
 * Selecting a city navigates to /:slug (preserving the current sub-page like /calendar or /jobs).
 */
import { useState, useEffect, useRef } from "react";
import { MapPin, ChevronDown, Check } from "lucide-react";
import { useCity } from "@/lib/city-context";

export function CitySwitcher() {
  const { cities, currentCity, navigateToCity } = useCity();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
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
    navigateToCity(slug, true);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="button-city-switcher"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover-elevate transition-colors"
      >
        <MapPin className="h-3 w-3" />
        <span>
          {currentCity.displayName}, {currentCity.state}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 z-50 min-w-[200px] rounded-md border border-border bg-popover shadow-lg overflow-hidden"
          data-testid="menu-city-switcher"
        >
          <div className="px-3 py-2 border-b border-border bg-secondary/40">
            <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              Switch city
            </div>
          </div>
          <ul className="py-1 max-h-[60vh] overflow-y-auto">
            {cities.map((c) => {
              const isCurrent = c.slug === currentCity.slug;
              return (
                <li key={c.slug}>
                  <button
                    onClick={() => selectCity(c.slug)}
                    data-testid={`city-option-${c.slug}`}
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
