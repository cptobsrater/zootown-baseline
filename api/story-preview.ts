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
import { fileURLToPath } from "url";

// ESM-safe __dirname.
const __dirname = (() => {
  try {
    return fileURLToPath(new URL(".", import.meta.url));
  } catch {
    return process.cwd();
  }
})();

// The compiled SPA shell lives next to this function once Vercel builds it.
// We read it once and rewrite the <head> per request.
let cachedShell: string | null = null;
function loadShell(): string {
  if (cachedShell) return cachedShell;
  // On Vercel the lambda runs from /var/task and static output lives at
  // /var/task/public/index.html. We try several plausible paths.
  const candidates = [
    resolve(process.cwd(), "public/index.html"),
    resolve(process.cwd(), "dist/public/index.html"),
    resolve(__dirname, "../public/index.html"),
    resolve(__dirname, "../dist/public/index.html"),
    "/var/task/public/index.html",
  ];
  for (const p of candidates) {
    try {
      cachedShell = readFileSync(p, "utf-8");
      return cachedShell;
    } catch {
      /* try next */
    }
  }
  // Fallback: a minimal HTML shell. The script src path doesn't matter for
  // crawlers (they read meta tags) and humans will get the real bundle from
  // the bot-detection fallthrough if this branch is ever hit.
  cachedShell = `<!doctype html><html><head><meta charset="utf-8"><title>ZooTown</title></head><body><div id="root"></div></body></html>`;
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
  const canonical = `${originFromReq(req)}${path}`;
  if (Number.isFinite(storyId)) {
    try {
      // Hit storage directly instead of recursing through HTTP -- avoids
      // a self-fetch round-trip and the associated cold-start latency.
      const { storage } = await import("../server/storage.js");
      const story = await storage.getStory(storyId);
      if (story?.headline) headline = story.headline;
      if (story?.summary) {
        // Strip the leading machine-generated event summary prefix that
        // looks like 'YYYY-MM-DDTHH:MM:SS.000Z · ' (Logjam parser emits
        // this for calendar event rows). Falls back to the raw summary
        // for normal news rows where this regex doesn't match.
        summary = story.summary
          .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*·\s*/, "")
          .trim();
        // If after stripping we are left with nothing meaningful, fall back
        // to the headline so the share preview is never empty.
        if (summary.length < 8) summary = headline;
      }
    } catch (err) {
      // DB failure -- fall through with default tags. The client SPA will
      // still resolve the story once it loads.
      console.error("[story-preview] failed to load story", storyId, err);
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
    // Dynamic per-story share image: 1200x630 PNG generated by
    // api/og-image.ts (Edge runtime + @vercel/og) with headline, city color,
    // desk badge, and source name. Cache-busts by storyId so edits to a
    // headline produce a fresh image on next crawler refresh.
    `<meta property="og:image" content="${originFromReq(req)}/api/og-image?storyId=${storyId}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:image" content="${originFromReq(req)}/api/og-image?storyId=${storyId}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    // Tell the client about the deep-link target so the SPA can open the
    // drawer to this story without re-fetching when the URL is bookmarked.
    `<meta name="zootown:story-id" content="${storyId}" />`,
    `<meta name="zootown:city-slug" content="${escapeHtml(citySlug)}" />`,
    // Override the <title> too -- some browsers and share tools prefer it.
    `<title>${escapeHtml(headline)} — ZooTown</title>`,
  ].join("\n    ");

  const shell = loadShell();
  // Strip the default <title> and the default og:/twitter:/canonical tags
  // baked into index.html so our per-story versions are the only ones the
  // crawler sees. Twitter/X in particular reads the FIRST occurrence of
  // each og/twitter property, not the last, so this is required for X
  // shares to show the right preview (Facebook/iMessage/Slack happen to
  // tolerate either order but we want consistency).
  const html = shell
    .replace(/<title>[^<]*<\/title>/i, "")
    .replace(/<meta\s+property="og:[^"]+"\s+content="[^"]*"\s*\/?>\s*/gi, "")
    .replace(/<meta\s+name="twitter:[^"]+"\s+content="[^"]*"\s*\/?>\s*/gi, "")
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>\s*/gi, "")
    .replace(/<\/head>/i, `    ${ogTags}\n  </head>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Don't cache long -- ingest updates can change a headline/summary, and
  // social platforms re-fetch on every share.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.status(200).send(html);
}
