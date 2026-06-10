/**
 * City context — reads the current city slug from the URL (e.g. /missoula/...).
 * Every page that needs to scope its data passes `currentCity.slug` to the API.
 *
 * The provider also fetches the city list once and exposes it to the switcher.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

export interface City {
  id: number;
  slug: string;
  displayName: string;
  state: string;
  lat: number | null;
  lon: number | null;
  countyName: string | null;
  nwsZone: string | null;
}

interface CityContextValue {
  cities: City[];
  isLoading: boolean;
  currentCity: City;          // current active city (defaults to Missoula)
  navigateToCity: (slug: string, preservePath?: boolean) => void;
}

const DEFAULT_CITY: City = {
  id: 1,
  slug: "missoula",
  displayName: "Missoula",
  state: "MT",
  lat: 46.8721,
  lon: -113.994,
  countyName: "Missoula County",
  nwsZone: null,
};

const CityContext = createContext<CityContextValue | undefined>(undefined);

function citySlugFromPath(path: string): string {
  // Path looks like /missoula or /missoula/calendar; pull the first segment.
  const m = path.match(/^\/([a-z_]+)(?:\/|$)/i);
  return m?.[1]?.toLowerCase() ?? "missoula";
}

export function CityProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();

  const { data: cities = [], isLoading } = useQuery<City[]>({
    queryKey: ["/api/cities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cities");
      return (await res.json()) as City[];
    },
    staleTime: 60 * 60 * 1000, // cities change rarely
  });

  const slug = citySlugFromPath(location);
  const currentCity = useMemo<City>(() => {
    const match = cities.find((c) => c.slug === slug);
    return match ?? DEFAULT_CITY;
  }, [cities, slug]);

  function navigateToCity(newSlug: string, preservePath = true) {
    if (preservePath) {
      // Replace the city segment, keep the rest of the path. /missoula/calendar -> /billings/calendar
      const rest = location.replace(/^\/[a-z_]+/i, "");
      setLocation(`/${newSlug}${rest || ""}`);
    } else {
      setLocation(`/${newSlug}`);
    }
  }

  const value: CityContextValue = {
    cities,
    isLoading,
    currentCity,
    navigateToCity,
  };

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity must be used inside <CityProvider>");
  return ctx;
}
