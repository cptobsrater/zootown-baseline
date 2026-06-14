/**
 * Admin-side city context. Unlike the public CityProvider (which reads slug
 * from the URL path), the admin city is internal state — the admin switches
 * between cities via a dropdown on the admin shell without changing the URL.
 *
 * Every admin query/mutation should call `useAdminCity()` and append
 * `?city=${citySlug}` to scope the data to that city. Cross-city work (e.g.
 * triggering ingest for all sources, classifications) can ignore this.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type { City } from "./city-context";

interface AdminCityContextValue {
  cities: City[];
  isLoading: boolean;
  currentCity: City;
  setCurrentCitySlug: (slug: string) => void;
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

// Admin-only virtual scope. The backend treats slug="all" (or any non-real
// slug resolving to null) as cross-city. Anything that requires a single
// real city (URL routing to /:citySlug/..., weather lookups, etc.) must
// guard against this slug.
export const ALL_MONTANA_CITY: City = {
  id: 0,
  slug: "all",
  displayName: "All Montana",
  state: "MT",
  lat: 46.8721,
  lon: -113.994,
  countyName: null,
  nwsZone: null,
};

export function isAllMontana(city: City): boolean {
  return city.slug === "all";
}

const STORAGE_KEY = "zootown:adminCitySlug";
const AdminCityContext = createContext<AdminCityContextValue | undefined>(undefined);

function readInitialSlug(): string {
  if (typeof window === "undefined") return "missoula";
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "missoula";
  } catch {
    return "missoula";
  }
}

export function AdminCityProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string>(() => readInitialSlug());

  const { data: cities = [], isLoading } = useQuery<City[]>({
    queryKey: ["/api/cities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cities");
      return (await res.json()) as City[];
    },
    staleTime: 60 * 60 * 1000,
  });

  // The admin switcher includes a virtual "All Montana" scope as the first
  // option. It is NOT returned by the public /api/cities endpoint.
  const citiesWithAll = useMemo<City[]>(
    () => [ALL_MONTANA_CITY, ...cities],
    [cities],
  );

  const currentCity = useMemo<City>(() => {
    if (slug === "all") return ALL_MONTANA_CITY;
    return cities.find((c) => c.slug === slug) ?? DEFAULT_CITY;
  }, [cities, slug]);

  function setCurrentCitySlug(next: string) {
    setSlug(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const value: AdminCityContextValue = {
    cities: citiesWithAll,
    isLoading,
    currentCity,
    setCurrentCitySlug,
  };

  return <AdminCityContext.Provider value={value}>{children}</AdminCityContext.Provider>;
}

export function useAdminCity(): AdminCityContextValue {
  const ctx = useContext(AdminCityContext);
  if (!ctx) throw new Error("useAdminCity must be used inside <AdminCityProvider>");
  return ctx;
}
