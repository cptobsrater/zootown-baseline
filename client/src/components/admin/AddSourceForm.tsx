import { useState } from "react";
import {
  DESKS,
  FEED_TYPES,
  SOURCE_TYPES,
  SOURCE_CATEGORIES,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, FlaskConical, X, ExternalLink } from "lucide-react";

type FeedType = (typeof FEED_TYPES)[number];
type SrcType = (typeof SOURCE_TYPES)[number];
type SrcCategory = (typeof SOURCE_CATEGORIES)[number];

interface PreviewItem {
  title: string;
  url: string;
  summary?: string | null;
  publishedAt?: string | null;
}
interface TestResult {
  mode: "live" | "mock" | "error";
  error?: string | null;
  totalItems: number;
  preview: PreviewItem[];
}

interface Props {
  onClose: () => void;
}

export function AddSourceForm({ onClose }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedType, setFeedType] = useState<FeedType>("rss");
  const [sourceType, setSourceType] = useState<SrcType>("Local News");
  const [parserKey, setParserKey] = useState("");
  const [desks, setDesks] = useState<string[]>(["city"]);
  const [cadenceMinutes, setCadenceMinutes] = useState(30);
  const [category, setCategory] = useState<SrcCategory>("news");

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  function buildSpec() {
    return {
      name: name.trim(),
      url: url.trim(),
      feedUrl: feedUrl.trim() || undefined,
      feedType,
      parserKey: parserKey.trim() || undefined,
      sourceType,
      desks,
      cadenceMinutes,
      category,
    };
  }

  function toggleDesk(d: string) {
    setDesks((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  async function runTest() {
    setError(null);
    if (!name || !url) {
      setError("Name and URL are required to test.");
      return;
    }
    if (desks.length === 0) {
      setError("Pick at least one desk.");
      return;
    }
    setTesting(true);
    setTest(null);
    try {
      const res = await apiRequest("POST", "/api/admin/sources/test", buildSpec());
      const json = (await res.json()) as TestResult;
      setTest(json);
    } catch (err: any) {
      setError(err?.message ?? "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setError(null);
    if (!name || !url) {
      setError("Name and URL are required.");
      return;
    }
    if (desks.length === 0) {
      setError("Pick at least one desk.");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/admin/sources", buildSpec());
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Save failed.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      data-testid="modal-add-source"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-card-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Add source
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Test before saving — preview what the parser would extract
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="button-close-add-source"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background hover-elevate"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-source-name"
                placeholder="Missoula Current"
                className={inputCls}
              />
            </Field>
            <Field label="Site URL">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="input-source-url"
                placeholder="https://missoulacurrent.com"
                className={inputCls}
              />
            </Field>

            <Field label="Feed URL (optional, for RSS/Atom)" className="md:col-span-2">
              <input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                data-testid="input-source-feed-url"
                placeholder="https://missoulacurrent.com/feed"
                className={inputCls}
              />
            </Field>

            <Field label="Feed type">
              <select
                value={feedType}
                onChange={(e) => setFeedType(e.target.value as FeedType)}
                data-testid="select-feed-type"
                className={inputCls}
              >
                {FEED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source type">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as SrcType)}
                data-testid="select-source-type"
                className={inputCls}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SrcCategory)}
                data-testid="select-source-category"
                className={inputCls}
              >
                {SOURCE_CATEGORIES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cadence (minutes)">
              <input
                type="number"
                min={5}
                max={1440}
                value={cadenceMinutes}
                onChange={(e) => setCadenceMinutes(parseInt(e.target.value || "30", 10))}
                data-testid="input-source-cadence"
                className={inputCls}
              />
            </Field>

            <Field label="Parser key (optional)" className="md:col-span-2">
              <input
                value={parserKey}
                onChange={(e) => setParserKey(e.target.value)}
                data-testid="input-source-parser-key"
                placeholder="leave blank to auto-pick"
                className={inputCls}
              />
            </Field>

            <Field label="Desks (multi-select)" className="md:col-span-2">
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DESKS.map((d) => {
                  const active = desks.includes(d);
                  return (
                    <button
                      type="button"
                      key={d}
                      onClick={() => toggleDesk(d)}
                      data-testid={`toggle-desk-${d}`}
                      className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-mono uppercase tracking-[0.12em] hover-elevate ${
                        active
                          ? "border-foreground/30 bg-secondary text-foreground"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-source-error"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runTest}
              disabled={testing}
              data-testid="button-test-source"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate active-elevate-2 disabled:opacity-60"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" />
              )}
              Test source
            </button>
            <button
              onClick={save}
              disabled={saving || !test || test.mode === "error"}
              data-testid="button-save-source"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
              title={!test ? "Run a successful test first" : undefined}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save source
            </button>
            <span className="text-[0.7rem] text-muted-foreground">
              You must run a successful test before saving.
            </span>
          </div>

          {test && (
            <div className="rounded-md border border-card-border bg-background/50 p-3" data-testid="panel-test-result">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-mono uppercase tracking-[0.12em] ${
                    test.mode === "live"
                      ? "border-[hsl(var(--desk-city))]/30 bg-[hsl(var(--desk-city))]/10 text-[hsl(var(--desk-city))]"
                      : test.mode === "mock"
                      ? "border-[hsl(var(--desk-business))]/30 bg-[hsl(var(--desk-business))]/10 text-[hsl(var(--desk-business))]"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  {test.mode}
                </span>
                <span className="text-xs text-muted-foreground">
                  {test.totalItems} item{test.totalItems === 1 ? "" : "s"} · showing {test.preview.length}
                </span>
                {test.error && (
                  <span className="text-xs text-destructive" data-testid="text-test-error">
                    {test.error}
                  </span>
                )}
              </div>
              <ul className="mt-3 divide-y divide-border">
                {test.preview.map((p, i) => (
                  <li key={`${p.url}-${i}`} className="py-2">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-serif text-[0.95rem] font-medium text-foreground hover:underline"
                      data-testid={`link-preview-${i}`}
                    >
                      {p.title}
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </a>
                    {p.summary && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{p.summary}</p>
                    )}
                  </li>
                ))}
                {test.preview.length === 0 && (
                  <li className="py-3 text-xs text-muted-foreground">
                    No items returned. Check the feed URL or feed type.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
