# ZooTown

AI-assisted local aggregation for **Missoula, Montana**. ZooTown monitors trusted local sources, rewrites updates into short feed posts, and always links back to the original. Not a newsroom — every post is a source-linked summary with a transparent attribution trail and a human-in-the-loop review path for sensitive topics.

The prototype now runs a **real ingestion pipeline**: 11 Missoula sources are polled on a cadence, RSS feeds are parsed live, HTML pages are fetched and filtered, and items are deduped and clustered across sources. Fixtures are retained as a fallback when a feed is blocked or returns nothing.

---

## What's real vs. mocked

| Area | Status |
| ---- | ------ |
| UI / UX (home, drawer, filters, search, admin) | **Real.** Production-quality React + Tailwind + shadcn. |
| Data model (`shared/schema.ts`) | **Real.** Stories, sources registry, ingest runs, story-sources (cluster attributions). |
| Ingestion pipeline | **Real.** In-process scheduler · RSS + HTML fetchers · canonical-URL dedupe · title-similarity clustering · fixtures fallback. |
| Source registry (11 Missoula sources) | **Real.** Live RSS for Missoulian, Missoula Current, KPAX, City of Missoula. Live HTML for Destination Missoula, Downtown Partnership, Library, ZACC. Fixtures fallback for County, Fairgrounds, Chamber when their endpoints 4xx. |
| `/api/pulse` 5-minute refresh | **Real.** Pulse is wired to the actual ingest scheduler — `lastIngestAt`, `lastIngestSource`, and `lastIngestMode` all come from the last run. |
| "New posts available" bar | **Real**, driven by real pulse changes. |
| Admin moderation (Drafts / Approved / Rejected) | **Real** UI + real PATCH endpoint. Edit/dedupe/flag rows are scaffold cards. |
| Admin → Sources & Health | **Real.** Per-source status dots, live/fixtures badge, cadence, last-checked, last-run item count, Run-now button, error notes. |
| Admin → Ingest log | **Real.** Last 40 runs with mode, fetched, added, duplicates, clustered, and errors. |
| AI summarization | **Not implemented** — still out of scope. Titles and snippets come straight from the source. |
| Sensitivity classifier | **Not implemented.** New items are auto-approved today; hook the review gate here before going fully live. |
| Authentication | **Not implemented.** The `/admin` route is unguarded; in production you'd add role-based auth. |

---

## Stack

- **Framework**: React + Vite on the client, Express on the server (single port).
- **Data**: SQLite via `better-sqlite3` + Drizzle ORM. Swap to Supabase by swapping `server/storage.ts` — the `IStorage` interface is stable.
- **UI**: Tailwind CSS v3 + shadcn/ui primitives (Radix under the hood). Custom design system in `client/src/index.css` (warm newsprint in light mode, deep navy in dark mode, three desk accent colors).
- **State / data-fetching**: `@tanstack/react-query` for polling and caching.
- **Routing**: `wouter` with hash routing (deploy-friendly).
- **Types**: TypeScript end-to-end via a shared `shared/schema.ts`.

Deployment target is Vercel-compatible: the frontend is a static bundle and the server can run as a Node backend (currently Express). For the stock "Next.js + Supabase + Vercel" stack called for in the prompt, port `server/routes.ts` to Next route handlers (one per endpoint) and swap the storage implementation. The data model and React tree drop in untouched.

---

## Getting started

```bash
cp .env.example .env   # then set ADMIN_PASSWORD_HASH before any public deploy
npm install
npm run dev            # http://localhost:5000
```

The first request auto-creates `data.db` and seeds it. Delete `data.db` to reseed.

### Before pushing to GitHub / deploying publicly

- The dev fallback hash in `server/auth.ts` is `sha256("MissoulaRocks")`. **Rotate it.** Generate a new hash with `printf '%s' 'your-new-password' | shasum -a 256` and set `ADMIN_PASSWORD_HASH` in your environment (Vercel/Fly/Render/etc.).
- `data.db`, `node_modules/`, `dist/`, and `.env*` are all gitignored — safe to push as-is.
- SQLite via `better-sqlite3` is fine for the prototype and single-instance deployments, but **not production-grade persistence**. For durable multi-region production data, swap `server/storage.ts` to Supabase (Postgres) or move the API to Vercel + Supabase / Vercel Postgres. The `IStorage` interface is stable, so the React tree drops in untouched.

Entrypoints:

- `/#/` — homepage
- `/#/admin` — moderation queue

---

## Project structure

```
client/src/
├── components/
│   ├── Logo.tsx           · custom SVG wordmark
│   ├── TopBar.tsx         · sticky header, desk tabs, search, theme toggle
│   ├── LeftRail.tsx       · desk filters + "how it works"
│   ├── RightRail.tsx      · top stories · events · trending tags · sources
│   ├── StoryCard.tsx      · feed card + skeleton
│   ├── StoryDrawer.tsx    · detail panel with source attribution
│   └── SourcesDialog.tsx  · watched-sources list + sourcing rules
├── pages/
│   ├── home.tsx           · homepage (feed, polling, new-posts bar)
│   └── admin.tsx          · moderation queue scaffold
├── lib/
│   ├── theme.tsx          · ThemeProvider (dark/light)
│   ├── format.ts          · time, tags, desk metadata
│   └── queryClient.ts     · react-query + apiRequest helper
└── index.css              · design tokens (light + dark)

server/
├── routes.ts              · /api/stories · /api/pulse · /api/events · /api/sources · /api/top-stories · /api/trending-tags · admin PATCH
├── storage.ts             · SQLite + IStorage interface + auto-DDL + seeding
└── seed.ts                · 30-day seed feed, events, sources

shared/
└── schema.ts              · stories, events, sources (Drizzle + Zod)
```

---

## Ingestion pipeline (how it actually works)

Lives entirely in `server/ingest/`. The scheduler starts automatically when the server boots and ticks every 60 seconds.

```
server/ingest/
├── types.ts        · RawItem, FetchResult, Fetcher interfaces
├── rss.ts          · RSS/Atom fetcher (fast-xml-parser, 7s timeout, UA set)
├── html.ts         · Generic article-link parser with nav-text denylist
├── fixtures.ts     · Keyed fixture pool, rotates 1–3 items per run
├── normalize.ts    · canonicalizeUrl, classifyDesk, autoTag, inferLocation, decodeEntities
└── ingester.ts     · Orchestrator: ingestSource, ingestAll, startScheduler
```

**Per tick** (every 60 seconds):

1. Look up each active source whose `last_checked_at + cadence_minutes` is in the past.
2. For each one: try **live fetch** (RSS or HTML, depending on `feed_type`).
3. If live fails or returns zero items, fall back to the **fixtures pool** keyed by source name. Fixtures rotate based on the current minute so the feed keeps moving even when every remote is down.
4. For each raw item:
   - **Canonicalize** the URL — strip `utm_*`, `fbclid`, `gclid`, `mc_*`, `ref`, trailing slash, fragment.
   - **Dedupe** by canonical URL (skip if already in `stories`).
   - **Cluster** against the last 72 hours: if another story's title has Jaccard similarity ≥ 0.6 on tokens (≥ 3 chars, minus stopwords including `missoula`, `mt`, `montana`), attach this source as an extra attribution row in `story_sources` instead of inserting a new story.
   - Otherwise **normalize** — desk classification (keyword scoring against City / Business / Culture), auto-tagging, location inference, `status` (`New` / `Event` / `Developing`), HTML entity decoding.
   - `INSERT` into `stories` with `mod_state = "approved"`, `is_seeded = false`, and attach a primary `story_sources` row.
5. Update `sources.last_status` (`ok` / `error` / `stale`), `last_mode` (`live` / `mock`), `last_error`, `last_items`, and write a summary row to `ingest_runs`.

**Manual triggers:**

- `POST /api/ingest/run` — run every due source now (admin "Refresh all")
- `POST /api/ingest/run/:sourceId` — run one source (admin "Run now")
- `GET /api/ingest/runs?limit=40` — tail of the ingest log

**Pulse wiring:** `/api/pulse` now returns real fields from the last run:

```
lastIngestAt · lastIngestSource · lastIngestAdded · lastIngestMode · recentAdded
```

The front-end's 30-second poll sees a new `latestPublishedAt`, increments `newPostsCount`, and renders the "new posts available" bar — driven entirely by real ingestion now.

---

## Adding a new source

1. Append a row to `SEED_SOURCES` in `server/seed.ts`:
   ```ts
   { name: "My Source", url: "https://example.com", feedUrl: "https://example.com/feed/",
     feedType: "rss",        // "rss" | "html" | "json"
     sourceType: "Local News", cadenceMinutes: 15, parserKey: null }
   ```
2. For HTML sources, set `feedType: "html"` and optionally a `parserKey` — the generic article-link scanner in `server/ingest/html.ts` handles most sites. Add the source's path signature (e.g. `/news/`, `/events/`) to `ARTICLEISH_SEGMENTS` only if nothing matches yet.
3. If you want fixtures fallback content for the source, add an entry to `POOL` in `server/ingest/fixtures.ts` keyed by the exact source name.
4. Delete `data.db` and restart — the new source will be seeded and picked up on the next scheduler tick.

---

## Clustering explained

Two sources reporting the same story should collapse into **one feed item with multiple attributions**, not two near-duplicate cards.

- **Canonical-URL dedupe** catches exact and near-exact reprints.
- **Title-similarity clustering** catches the common case: Missoulian and KPAX covering the same council vote with slightly different headlines.
  - Tokenize each title: lowercase, drop non-letters, keep words ≥ 3 chars, drop stopwords (includes `missoula`, `mt`, `montana` so city-level stories don't over-cluster).
  - Compute Jaccard similarity against each story in the last 72 hours.
  - If best match is ≥ **0.6**, attach this source as an extra row in `story_sources` pointing at the existing story.
  - Otherwise insert a new story and attach its primary source.

On the feed, clustered stories get a `+N source(s)` chip next to the primary source name. The story drawer shows a "Also reported by" block with a "Read" link per attribution.

---

## Fixtures behavior

Every source has a small pool of realistic Missoula headlines keyed by source name in `server/ingest/fixtures.ts`. The fetcher falls back to fixtures **only** when:

- The live request fails (network error, timeout, non-2xx),
- Or the live response parses to zero items.

Even then, fixtures pick 1–3 items rotated by the current minute, so the feed stays fresh without flooding. The admin Sources panel surfaces this with a `FIXTURES` badge and the error note that triggered fallback (e.g. `HTTP 404`).

---

## Sourcing & editorial rules (baked into the UI)

These rules are listed in the Sources & About dialog and enforced structurally:

- Every post links to the original source (`source_url` is required).
- Every post shows a source label (`source_name` + `source_type` badge).
- Sensitive / medium+high risk items route to `mod_state = "draft"` — the moderation queue.
- No full-article republication — the `summary` field is capped at a short description.
- Public & reliable local sources first — the seed `sources` table only includes official civic channels, Missoula-based local news, and community calendars.
- AI-assisted, not AI-authored reporting — the product identifies itself as aggregation in the header chip and in the About dialog.

---

## Key API endpoints

```
GET    /api/stories?desk=&q=&limit=&cursor=&modState=   · includes sourceCount per item
GET    /api/stories/:id                                 · includes attached sources[]
PATCH  /api/stories/:id/mod                             · { modState }
GET    /api/events
GET    /api/sources                                     · source registry + health
GET    /api/top-stories
GET    /api/trending-tags
GET    /api/pulse                                       · wired to real ingest runs
POST   /api/ingest/run                                  · run every due source now
POST   /api/ingest/run/:sourceId                        · run one source now
GET    /api/ingest/runs?limit=40                        · tail of the ingest log
```

All responses are JSON. Pagination is cursor-based (offset semantics).

---

## What still needs to be done to go live

1. **Sensitivity classifier** — a small LLM-based gate that tags public-safety, legal, and health items as `medium+`. Flip freshly ingested items to `mod_state = "draft"` when flagged.
2. **LLM summarizer** — a constrained prompt that only uses the source snippet as ground truth. Never synthesize new facts. Always produce two strings: `summary` and optional `whyItMatters`. Today summaries come directly from source snippets.
3. **Auth on /admin** — gate the moderation queue + sources panel behind a real editor role.
4. **Duplicate merger** — expose the clustering backend as a "Mark duplicate" action in the admin queue.
5. **Event ingestion** — pull `events` on the same cadence. The Destination Missoula, Downtown Missoula, and Fairgrounds HTML fetchers are already in the registry — just wire them to the `events` table.
6. **Server-sent events / WebSocket** — replace the 30-second poll with SSE so the "new posts" bar is truly live.
7. **Observability beyond the admin panel** — forward ingest run rows to a proper log sink; alert on consecutive errors per source.
8. **Next.js / Supabase port (optional)** — swap `server/` for Next.js route handlers and `better-sqlite3` for `@supabase/supabase-js`. The ingestion pipeline, frontend, and types are portable as-is.

---

## Design notes

- Warm newsprint (36 24% 97%) + deep navy ink (220 30% 11%) in light mode; deep navy surface + sagebrush primary in dark mode.
- Three desk accents — Clark Fork blue (City), downtown copper (Business), sagebrush green (Culture).
- Editorial pairing: **Source Serif 4** for headlines, **Inter** for UI, **JetBrains Mono** for metadata.
- No purple gradients. No neon glow. No startup-hero stock imagery.
- Every interactive element uses the template's shared `hover-elevate` / `active-elevate-2` system for consistent feedback.

---

## License

Prototype code — MIT. Source attributions remain with their respective outlets and civic offices.
