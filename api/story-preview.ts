/**
 * Serves index.html for /:city/story/:storyId deep links, with Open Graph
 * meta tags injected so iMessage / Slack / Discord / Facebook / X show a
 * rich preview when the shared link is unfurled.
 *
 * Real users still get the same SPA bundle as before -- the React app reads
 * the deep-link path and opens the drawer to the story. The OG tags are
 * additive: they cost nothing for humans but unlock previews for bots.
 *
 * Configured via vercel.json so that /:city/story/:id rewrites land here
 * instead of the bare index.html.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "fs";
import { resolve } from "path";

// The compiled SPA shell lives next to this function once Vercel builds it.
// We read it once and rewrite the <head> per request.
let cachedShell: string | null = null;
function loadShell(): string {
  if (cachedShell) return cachedShell;
  // Vercel's filesystem layout: api/* runs alongside the static output at
  // /public (or /dist/public on build). We try a couple of plausible paths.
  for (const p of [
    resolve(process.cwd(), "dist/public/index.html"),
    resolve(process.cwd(), "public/index.html"),
    resolve(__dirname, "../dist/public/index.html"),
    resolve(__dirname, "../public/index.html"),
  ]) {
    try {
      cachedShell = readFileSync(p, "utf-8");
      return cachedShell;
    } catch {
      /* try next */
    }
  }
  // Fallback: a minimal HTML that still works for crawlers and lets the
  // SPA loader bootstrap normally on the client.
  cachedShell = `<!doctype html><html><head><meta charset="utf-8"><title>ZooTown</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
  return cachedShell;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function originFromReq(req: VercelRequest): string {
  // Behind Vercel's edge, x-forwarded-proto / host are set on every request.
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "www.zootownhub.com";
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel rewrites this function to /:city/story/:storyId. Extract the id
  // from the actual request URL (req.url is "/:city/story/:id").
  const path = (req.url || "").split("?")[0];
  const m = path.match(/^\/([^/]+)\/story\/(\d+)/);
  const storyId = m ? Number(m[2]) : NaN;
  const citySlug = m ? m[1] : "";

  let headline = "ZooTown";
  let summary = "Local Montana news, events, and stories.";
  let canonical = `${originFromReq(req)}${path}`;
  if (Number.isFinite(storyId)) {
    try {
      const apiRes = await fetch(`${originFromReq(req)}/api/stories/${storyId}`);
      if (apiRes.ok) {
        const story = (await apiRes.json()) as { headline?: string; summary?: string };
        if (story.headline) headline = story.headline;
        if (story.summary) summary = story.summary;
      }
    } catch {
      // Network failure -- fall through with default tags. The client SPA
      // will still resolve the story once it loads.
    }
  }

  const ogTags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="ZooTown" />`,
    `<meta property="og:title" content="${escapeHtml(headline)}" />`,
    `<meta property="og:description" content="${escapeHtml(summary)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(headline)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(summary)}" />`,
    // Static fallback share image. Replace with a dynamic OG image generator
    // (e.g. /api/og-image?id=) once we have one.
    `<meta property="og:image" content="${originFromReq(req)}/apple-touch-icon.png" />`,
    `<meta name="twitter:image" content="${originFromReq(req)}/apple-touch-icon.png" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    // Tell the client about the deep-link target so the SPA can open the
    // drawer to this story without re-fetching when the URL is bookmarked.
    `<meta name="zootown:story-id" content="${storyId}" />`,
    `<meta name="zootown:city-slug" content="${escapeHtml(citySlug)}" />`,
    // Override the <title> too -- some browsers and share tools prefer it.
    `<title>${escapeHtml(headline)} — ZooTown</title>`,
  ].join("\n    ");

  const shell = loadShell();
  // Inject the meta tags just before </head>. Strip the existing <title> tag
  // since we are providing our own.
  const html = shell
    .replace(/<title>[^<]*<\/title>/i, "")
    .replace(/<\/head>/i, `    ${ogTags}\n  </head>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Don't cache long -- ingest updates can change a headline/summary, and
  // social platforms re-fetch on every share.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.status(200).send(html);
}
