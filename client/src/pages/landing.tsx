/**
 * Landing page at the root URL. Replaces the old auto-redirect to /missoula.
 * Shows the ZooTown wordmark plus a grid of location pills — click one to
 * jump to that city's feed (e.g. /billings, /greatfalls).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapPin, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { useTheme } from "@/lib/theme";
import { Sun, Moon } from "lucide-react";
import type { City } from "@/lib/city-context";

export default function Landing() {
  const { theme, toggle } = useTheme();
  const { data: cities = [], isLoading } = useQuery<City[]>({
    queryKey: ["/api/cities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cities");
      return (await res.json()) as City[];
    },
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-4 py-3 md:px-6">
          <Wordmark />
          <button
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover-elevate"
            data-testid="button-theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-12 md:px-6 md:py-20">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            <MapPin className="h-3 w-3" />
            Pick your city
          </span>
          <h1 className="mt-4 font-serif text-[2.2rem] md:text-[3rem] font-semibold leading-[1.05] tracking-tight text-foreground">
            Local news, civic events, and jobs <br className="hidden sm:inline" />
            <span className="text-muted-foreground">across Montana.</span>
          </h1>
          <p className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed">
            ZooTown is an AI-assisted local aggregator. Choose a city to see what's
            happening today — every story links back to the original source.
          </p>
        </div>

        {/* City pills */}
        <div className="mt-10 md:mt-14">
          <div className="mb-4 flex items-center justify-center gap-2 font-mono text-[0.64rem] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="h-px w-8 bg-border" />
            10 Montana cities
            <span className="h-px w-8 bg-border" />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[68px] animate-pulse rounded-full border border-border bg-card/60"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
              {cities.map((c) => (
                <Link
                  key={c.slug}
                  href={`/${c.slug}`}
                  data-testid={`landing-city-${c.slug}`}
                  className="group inline-flex items-center justify-between gap-2 rounded-full border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground hover-elevate active-elevate-2 transition-colors hover:border-primary/40"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    <span className="truncate">{c.displayName}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="mt-16 md:mt-24 text-center">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            New cities · 5-min ingest · sources linked
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Don't see your town?{" "}
            <a
              href="mailto:hello@zootownhub.com"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Suggest one
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
