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

  const currentCity = useMemo<City>(() => {
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
    cities,
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
