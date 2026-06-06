import type { Source } from "@shared/schema";
import type { Fetcher, FetchResult, RawItem } from "./types";
import { loadFixture } from "./fixtures";

/**
 * Headless browser fetcher for sources that require JavaScript execution
 * (Facebook Events, ZipRecruiter, etc.). Uses a shared Playwright browser
 * with a single context to amortize startup cost across calls.
 *
 * Each headless parser is registered in HEADLESS_PARSERS. The function receives
 * a Page already navigated to source.feedUrl and returns RawItem[].
 */

import type { Browser, Page } from "playwright";

let _browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
        ],
      });
    })();
  }
  return _browserPromise;
}

export async function closeHeadlessBrowser() {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close().catch(() => {});
    _browserPromise = null;
  }
}

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

type HeadlessParser = (page: Page, source: Source) => Promise<RawItem[]>;

/* ------------------------------------------------------------------ *
 * Facebook Events in Missoula
 * ------------------------------------------------------------------ */
const facebookEventsParser: HeadlessParser = async (page, source) => {
  // Wait for the events grid (or the login wall — FB will sometimes show one)
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Try to dismiss the cookie/login overlay if any
  await page.keyboard.press("Escape").catch(() => {});

  // FB event cards live behind aria roles. We pull anchor tags that point to /events/<id>/.
  const items = await page.evaluate(() => {
    const out: Array<{ title: string; url: string; summary?: string; publishedAt?: string }> = [];
    const seen = new Set<string>();
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/events/"]'));
    for (const a of anchors) {
      const href = a.href;
      const m = href.match(/\/events\/(\d+)/);
      if (!m) continue;
      // Pull title from the closest heading-like element or the anchor's own text
      const root = a.closest("[role='article'], div") ?? a;
      const heading = root.querySelector("span[dir='auto'], h2, h3, strong");
      let title = heading?.textContent?.trim() || a.textContent?.trim() || "";
      if (!title || title.length < 6 || title.length > 220) continue;
      // Strip "Interested ·" prefix or attendance counts
      title = title.replace(/^Interested\s*·\s*/i, "").replace(/\s+\d+ (going|interested).*/i, "").trim();
      const url = `https://www.facebook.com/events/${m[1]}/`;
      if (seen.has(url)) continue;
      seen.add(url);
      // Some cards have a date span (look for the next sibling span with month abbr)
      const dateNode = root.querySelector("span[dir='auto']:nth-of-type(1)");
      const summary = dateNode?.textContent?.trim() || undefined;
      out.push({ title, url, summary });
      if (out.length >= 12) break;
    }
    return out;
  });

  return items;
};

/* ------------------------------------------------------------------ *
 * ZipRecruiter Missoula jobs
 * ------------------------------------------------------------------ */
const ziprecruiterParser: HeadlessParser = async (page, source) => {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const items = await page.evaluate(() => {
    const out: Array<{ title: string; url: string; summary?: string; categories?: string[] }> = [];
    const seen = new Set<string>();
    // ZipRecruiter cards: article[data-testid="job-card"], h2 a[href*="/jobs/"]
    const cards = Array.from(document.querySelectorAll('article, [class*="job_result"], [class*="JobResult"]'));
    for (const card of cards) {
      const titleEl = card.querySelector('h2 a, a[class*="title"], a[href*="/jobs/"]');
      const title = titleEl?.textContent?.trim();
      const href = (titleEl as HTMLAnchorElement | null)?.href;
      if (!title || !href) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const company = card.querySelector('[class*="company"], a[class*="company"]')?.textContent?.trim() ?? "";
      const location = card.querySelector('[class*="location"], [class*="Location"]')?.textContent?.trim() ?? "";
      out.push({
        title,
        url: href,
        summary: [company, location].filter(Boolean).join(" · "),
        categories: company ? [company] : [],
      });
      if (out.length >= 30) break;
    }
    return out;
  });

  return items;
};

const HEADLESS_PARSERS: Record<string, HeadlessParser> = {
  "facebook-events-missoula": facebookEventsParser,
  "ziprecruiter-missoula": ziprecruiterParser,
};

export const headlessFetcher: Fetcher = {
  async fetch(source, opts): Promise<FetchResult> {
    const timeoutMs = opts?.timeoutMs ?? 12_000;
    const parserKey = source.parserKey ?? "";
    const parser = HEADLESS_PARSERS[parserKey];
    if (!source.feedUrl || !parser) {
      return { mode: "mock", items: loadFixture(source), error: "no headless parser configured" };
    }
    let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
    let page: Page | null = null;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        timezoneId: "America/Denver",
      });
      page = await context.newPage();
      await page.goto(source.feedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      const items = await parser(page, source);
      if (items.length === 0) {
        return { mode: "mock", items: loadFixture(source), error: "headless parser produced 0 items" };
      }
      return { mode: "live", items };
    } catch (err: any) {
      return { mode: "mock", items: loadFixture(source), error: err?.message ?? String(err) };
    } finally {
      try { await page?.close(); } catch {}
      try { await context?.close(); } catch {}
    }
  },
};

// Lightweight job-board fetchers exposed for the Jobs system (separate from Story ingestion).
export interface RawJob {
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string; // ISO
  employmentType?: string;
  source: "indeed" | "ziprecruiter" | "montana_joblink";
}

export async function fetchZipRecruiterJobs(query: string, location = "Missoula, MT"): Promise<RawJob[]> {
  const q = encodeURIComponent(query || "");
  const l = encodeURIComponent(location);
  const url = `https://www.ziprecruiter.com/jobs-search?search=${q}&location=${l}&radius=25`;
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      timezoneId: "America/Denver",
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(1500);
    const jobs = await page.evaluate(() => {
      const out: any[] = [];
      const seen = new Set<string>();
      const cards = Array.from(
        document.querySelectorAll('article[data-testid="job-card"], article[class*="job_result"], article[class*="JobResult"]'),
      );
      for (const card of cards) {
        const titleEl = card.querySelector('h2 a, a[class*="title"], a[href*="/jobs/"], a[href*="/c/"]');
        const title = titleEl?.textContent?.trim() ?? "";
        const href = (titleEl as HTMLAnchorElement | null)?.href ?? "";
        if (!title || !href || seen.has(href)) continue;
        seen.add(href);
        const company = card.querySelector('[class*="company_name"], a[class*="company"], [data-testid="job-card-company"]')?.textContent?.trim() ?? "";
        const location = card.querySelector('[class*="location"], [class*="Location"], [data-testid="job-card-location"]')?.textContent?.trim() ?? "Missoula, MT";
        out.push({ title, url: href, company, location });
        if (out.length >= 40) break;
      }
      return out;
    });
    return jobs.map((j: any) => ({ ...j, source: "ziprecruiter" as const }));
  } catch {
    return [];
  } finally {
    try { await page?.close(); } catch {}
    try { await context?.close(); } catch {}
  }
}
