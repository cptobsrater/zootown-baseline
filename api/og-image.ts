/**
 * Dynamic Open Graph image generator for shared story links.
 *
 * Renders a 1200x630 PNG via @vercel/og + Satori (Node runtime).
 *
 * URL contract: /api/og-image?storyId=1604
 *
 * Implementation note: this file is .ts (not .tsx) and uses
 * React.createElement directly instead of JSX so it compiles cleanly under
 * Vercel's default Node runtime without needing a JSX transform.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { unstable_createNodejsStream } from "@vercel/og";
import React from "react";

// Per-city brand colors. Each of the 10 cities has a unique accent + tint
// so shared cards are immediately recognizable.
const CITY_COLORS: Record<string, { accent: string; tint: string; name: string }> = {
  missoula:    { accent: "#3b82f6", tint: "#0b1e3a", name: "Missoula"    },
  billings:    { accent: "#e0883b", tint: "#3a1a0b", name: "Billings"    },
  greatfalls:  { accent: "#9ec664", tint: "#1a2e0f", name: "Great Falls" },
  bozeman:     { accent: "#6ba8d4", tint: "#0f2638", name: "Bozeman"     },
  butte:       { accent: "#d4663b", tint: "#2e0f0b", name: "Butte"       },
  helena:      { accent: "#d4b86b", tint: "#2a230f", name: "Helena"      },
  kalispell:   { accent: "#6bc4a8", tint: "#0f2a23", name: "Kalispell"   },
  havre:       { accent: "#9a6bc4", tint: "#1a0f2a", name: "Havre"       },
  whitefish:   { accent: "#6bc4c4", tint: "#0f2a2a", name: "Whitefish"   },
  laurel:      { accent: "#c46b8a", tint: "#2a0f1a", name: "Laurel"      },
};

const DESK_COLORS: Record<string, string> = {
  city:          "#3b82f6",
  business:      "#10b981",
  crime:         "#dc2626",
  sports:        "#facc15",
  health:        "#06b6d4",
  entertainment: "#ec4899",
  people:        "#a78bfa",
  history:       "#94a3b8",
};

const CITY_BY_ID: Record<number, string> = {
  1: "missoula", 2: "billings", 3: "greatfalls", 4: "bozeman",
  5: "butte",    6: "helena",   7: "kalispell",  8: "havre",
  9: "whitefish", 10: "laurel",
};

function originFromReq(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers.host as string) ||
    "www.zootownhub.com";
  return `${proto}://${host}`;
}

function normalizeText(s: string): string {
  return s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

// Tiny helper so the createElement tree below stays readable.
const h = React.createElement;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = new URL(req.url ?? "/", originFromReq(req));
    const storyIdParam = url.searchParams.get("storyId");
    const storyId = storyIdParam ? Number(storyIdParam) : NaN;

    let headline = "ZooTown";
    let desk = "city";
    let citySlug = "missoula";
    let sourceName = "Montana Local";

    if (Number.isFinite(storyId)) {
      try {
        const { storage } = await import("../server/storage.js");
        const story = await storage.getStory(storyId);
        if (story?.headline) headline = normalizeText(story.headline);
        if (story?.desk) desk = story.desk;
        if (story?.cityId && CITY_BY_ID[story.cityId]) {
          citySlug = CITY_BY_ID[story.cityId];
        }
        if (story?.sourceName) sourceName = normalizeText(story.sourceName);
      } catch (err) {
        console.error("[og-image] failed to load story", storyId, err);
      }
    }

    const city = CITY_COLORS[citySlug] ?? CITY_COLORS.missoula;
    const deskColor = DESK_COLORS[desk] ?? DESK_COLORS.city;
    const displayHeadline =
      headline.length > 140 ? headline.slice(0, 137) + "..." : headline;
    const displaySource =
      sourceName.length > 60 ? sourceName.slice(0, 57) + "..." : sourceName;
    const headlineFontSize = displayHeadline.length > 80 ? 56 : 72;

    // Build the element tree via React.createElement instead of JSX so the
    // file compiles cleanly under Vercel's default Node runtime.
    const element = h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px 80px",
          background: `linear-gradient(135deg, ${city.tint} 0%, #050a14 100%)`,
          color: "#f5f1e8",
          fontFamily: "serif",
        },
      },
      // Top row: city + desk badge
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: city.accent,
          },
        },
        h("span", null, city.name),
        h("span", { style: { opacity: 0.5 } }, "\u00b7"),
        h(
          "span",
          {
            style: {
              background: deskColor,
              color: "#0b0b0b",
              padding: "6px 18px",
              borderRadius: 999,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.14em",
            },
          },
          desk.toUpperCase(),
        ),
      ),
      // Headline
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: headlineFontSize,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#fafafa",
            fontFamily: "serif",
            letterSpacing: "-0.01em",
          },
        },
        displayHeadline,
      ),
      // Bottom row: source + ZooTown wordmark
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              fontSize: 26,
              color: "rgba(245, 241, 232, 0.7)",
              fontFamily: "sans-serif",
            },
          },
          displaySource,
        ),
        h(
          "div",
          {
            style: { display: "flex", alignItems: "center", gap: 14 },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "#f5f1e8",
                color: "#0b0b0b",
                fontSize: 44,
                fontWeight: 900,
                fontFamily: "serif",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              },
            },
            "Z",
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 36,
                fontWeight: 700,
                fontFamily: "serif",
                color: "#f5f1e8",
              },
            },
            "ZooTown",
          ),
        ),
      ),
    );

    const stream = await unstable_createNodejsStream(element, {
      width: 1200,
      height: 630,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    res.statusCode = 200;
    stream.pipe(res);
  } catch (err) {
    console.error("[og-image] render failed:", err);
    res.status(500).send("og image failed");
  }
}
