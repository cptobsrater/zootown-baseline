import { XMLParser } from "fast-xml-parser";
import type { Source } from "@shared/schema";
import type { Fetcher, FetchResult, RawItem } from "./types";
import { loadFixture } from "./fixtures";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  textNodeName: "#text",
});

function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v["#text"] === "string") return v["#text"];
  return String(v);
}

function toIso(d?: string): string | undefined {
  if (!d) return undefined;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseRss(xml: string): RawItem[] {
  const doc = parser.parse(xml);
  const items: RawItem[] = [];

  // RSS 2.0
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    for (const it of asArray<any>(rssItems)) {
      const title = stripHtml(asString(it.title));
      const url = asString(it.link) ?? asString(it.guid) ?? "";
      if (!title || !url) continue;
      items.push({
        title,
        url,
        summary: stripHtml(asString(it.description) ?? asString(it["content:encoded"])),
        publishedAt: toIso(asString(it.pubDate) ?? asString(it["dc:date"])),
        author: asString(it.author) ?? asString(it["dc:creator"]),
        categories: asArray<any>(it.category).map((c) => stripHtml(asString(c) ?? "")).filter(Boolean),
      });
    }
    return items;
  }

  // Atom
  const atomEntries = doc?.feed?.entry;
  if (atomEntries) {
    for (const it of asArray<any>(atomEntries)) {
      const title = stripHtml(asString(it.title));
      const linkNode = Array.isArray(it.link)
        ? it.link.find((l: any) => l?.["@_rel"] !== "self") ?? it.link[0]
        : it.link;
      const url = typeof linkNode === "string" ? linkNode : linkNode?.["@_href"] ?? "";
      if (!title || !url) continue;
      items.push({
        title,
        url,
        summary: stripHtml(asString(it.summary) ?? asString(it.content)),
        publishedAt: toIso(asString(it.published) ?? asString(it.updated)),
        author: asString(it.author?.name),
        categories: asArray<any>(it.category).map((c) => asString(c?.["@_term"]) ?? "").filter(Boolean),
      });
    }
    return items;
  }

  return items;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ZooTown/0.1 (+https://zootown.pplx.app; aggregator-prototype)",
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export const rssFetcher: Fetcher = {
  async fetch(source, opts): Promise<FetchResult> {
    const timeoutMs = opts?.timeoutMs ?? 7000;
    if (!source.feedUrl) {
      const mock = loadFixture(source);
      return { mode: "mock", items: mock, error: "no feed_url configured" };
    }
    try {
      const res = await fetchWithTimeout(source.feedUrl, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRss(xml);
      if (items.length === 0) {
        const mock = loadFixture(source);
        return { mode: "mock", items: mock, error: "live feed returned 0 items" };
      }
      return { mode: "live", items };
    } catch (err: any) {
      const mock = loadFixture(source);
      return { mode: "mock", items: mock, error: err?.message ?? String(err) };
    }
  },
};
