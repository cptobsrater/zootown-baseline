import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  CloudFog,
  CloudLightning,
  Wind,
  Droplets,
  AlertTriangle,
  MapPin,
} from "lucide-react";

interface WeatherResponse {
  location: string;
  temperatureF: number | null;
  conditionText: string;
  icon: string | null;
  humidity: number | null;
  windText: string | null;
  high: number | null;
  low: number | null;
  alerts: Array<{ event: string; severity: string; headline?: string }>;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

function pickIcon(condition: string) {
  const c = (condition || "").toLowerCase();
  if (c.includes("thunder") || c.includes("storm")) return CloudLightning;
  if (c.includes("snow") || c.includes("flurr") || c.includes("blizz")) return CloudSnow;
  if (c.includes("rain") || c.includes("shower") || c.includes("drizzle")) return CloudRain;
  if (c.includes("fog") || c.includes("mist") || c.includes("haze") || c.includes("smoke"))
    return CloudFog;
  if (c.includes("clear") || c.includes("sunny")) return Sun;
  if (c.includes("cloud") || c.includes("overcast")) return Cloud;
  return Cloud;
}

export function Weather() {
  const { data, isLoading, isError } = useQuery<WeatherResponse>({
    queryKey: ["/api/weather"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/weather");
      return (await res.json()) as WeatherResponse;
    },
    refetchInterval: 10 * 60 * 1000, // 10 min
    staleTime: 5 * 60 * 1000,
  });

  // Skeleton — keeps space stable on first load
  if (isLoading || !data) {
    return (
      <div
        className="border-b border-border bg-secondary/30"
        data-testid="weather-skeleton"
        aria-busy="true"
      >
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-2 md:px-6">
          <div className="h-6 w-6 animate-pulse rounded-full bg-foreground/10" />
          <div className="h-3 w-24 animate-pulse rounded bg-foreground/10" />
          <div className="ml-auto h-3 w-32 animate-pulse rounded bg-foreground/10" />
        </div>
      </div>
    );
  }

  if (isError || data.temperatureF == null) {
    // Graceful — small chip with retry context. Keeps the band visible.
    return (
      <div className="border-b border-border bg-secondary/30">
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 py-2 text-xs text-muted-foreground md:px-6">
          <MapPin className="h-3.5 w-3.5" />
          <span>Missoula, MT — weather temporarily unavailable</span>
          <a
            href="https://forecast.weather.gov/MapClick.php?lat=46.8721&lon=-113.994"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.18em] hover:text-foreground"
          >
            NWS forecast →
          </a>
        </div>
      </div>
    );
  }

  const Icon = pickIcon(data.conditionText);
  const hasAlert = data.alerts && data.alerts.length > 0;
  const topAlert = hasAlert ? data.alerts[0] : null;
  const isSun = Icon === Sun;

  return (
    <div
      className="border-b border-border bg-secondary/30"
      data-testid="weather-band"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs md:px-6">
        {/* Left: temp + condition */}
        <div className="flex items-center gap-2">
          <Icon
            className={`h-4 w-4 ${
              isSun ? "text-yellow-500" : "text-foreground/80"
            }`}
            aria-hidden="true"
          />
          <span
            className="font-serif text-base font-semibold leading-none tabular-nums text-foreground"
            data-testid="text-weather-temp"
          >
            {Math.round(data.temperatureF)}°F
          </span>
          <span className="hidden sm:inline text-muted-foreground" data-testid="text-weather-condition">
            {data.conditionText}
          </span>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
            · Missoula, MT
          </span>
        </div>

        {/* Middle: hi/lo + humidity + wind (hidden on small) */}
        <div className="hidden md:flex items-center gap-3 text-muted-foreground">
          {(data.high != null || data.low != null) && (
            <span className="font-mono text-[0.7rem] tabular-nums">
              {data.high != null && (
                <>
                  H <span className="text-foreground">{Math.round(data.high)}°</span>
                </>
              )}
              {data.high != null && data.low != null && " · "}
              {data.low != null && (
                <>
                  L <span className="text-foreground">{Math.round(data.low)}°</span>
                </>
              )}
            </span>
          )}
          {data.humidity != null && (
            <span className="inline-flex items-center gap-1 font-mono text-[0.7rem] tabular-nums">
              <Droplets className="h-3 w-3" />
              {data.humidity}%
            </span>
          )}
          {data.windText && (
            <span className="inline-flex items-center gap-1 font-mono text-[0.7rem]">
              <Wind className="h-3 w-3" />
              {data.windText}
            </span>
          )}
        </div>

        {/* Alert chip (if any) */}
        {topAlert && (
          <a
            href="https://alerts.weather.gov/cap/mt.php"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-destructive/50 bg-destructive/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-destructive hover:bg-destructive/20"
            data-testid="weather-alert"
            title={topAlert.headline || topAlert.event}
          >
            <AlertTriangle className="h-3 w-3" />
            {topAlert.event}
            {data.alerts.length > 1 && <span>· +{data.alerts.length - 1}</span>}
          </a>
        )}

        {/* Right: source link */}
        <a
          href={data.sourceUrl || "https://forecast.weather.gov/MapClick.php?lat=46.8721&lon=-113.994"}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          data-testid="link-weather-source"
        >
          {data.source || "NWS"} →
        </a>
      </div>
    </div>
  );
}
