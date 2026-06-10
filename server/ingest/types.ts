import type { Source } from "../../shared/schema.js";

/** Raw item as returned by a fetcher, before normalization/dedupe/classification. */
export interface RawItem {
  title: string;
  url: string;
  summary?: string; // Plain-text excerpt or description, if provided
  publishedAt?: string; // ISO string, if known
  author?: string;
  categories?: string[]; // RSS <category> tags, if any
  eventDate?: string; // ISO string — set when item has event date metadata
}

export interface FetchResult {
  mode: "live" | "mock";
  items: RawItem[];
  error?: string;
}

export interface Fetcher {
  fetch(source: Source, opts?: { timeoutMs?: number }): Promise<FetchResult>;
}
