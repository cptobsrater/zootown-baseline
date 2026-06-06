import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { TopBar } from "@/components/TopBar";
import { Weather } from "@/components/Weather";
import { SourcesDialog } from "@/components/SourcesDialog";
import {
  Briefcase,
  MapPin,
  Phone,
  Building2,
  Search,
  Send,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface JobPost {
  id: number;
  title: string;
  business: string;
  address: string | null;
  phone: string | null;
  pay: string | null;
  body: string;
  submitterEmail: string | null;
  state: "pending" | "approved" | "rejected";
  submittedAt: string;
  approvedAt: string | null;
}

interface JobsResponse {
  jobs: JobPost[];
  fetchedAt: string;
}

function approvedDate(j: JobPost): string {
  const iso = j.approvedAt ?? j.submittedAt;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Recently";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const BODY_PLACEHOLDER = `Tell people about the job. A few things candidates like to see:

• Hours / shifts (e.g. "Weekdays 11am–3pm" or "Flexible — pick your schedule")
• Pay range or starting pay
• What the day-to-day looks like
• Any perks (free meals, tips pool, flexible scheduling)
• How to apply — drop in, call, email, etc.

Example: "We're hiring a part-time server at Top Hat. If you've ever wanted to work downtown nights, stop in any afternoon and ask for Sam. $14/hr + tips, weekends required."`;

export default function JobsPage() {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const jobsQuery = useQuery<JobsResponse>({
    queryKey: ["/api/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/jobs");
      return (await res.json()) as JobsResponse;
    },
  });

  const jobs = jobsQuery.data?.jobs ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return jobs;
    return jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(term) ||
        j.business.toLowerCase().includes(term) ||
        j.body.toLowerCase().includes(term),
    );
  }, [jobs, q]);

  // Submission form state
  const [form, setForm] = useState({
    title: "",
    business: "",
    address: "",
    phone: "",
    pay: "",
    body: "",
    submitterEmail: "",
  });
  const [submitState, setSubmitState] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }
  >({ kind: "idle" });

  const wordCount = form.body.trim().split(/\s+/).filter(Boolean).length;

  const submit = useMutation({
    mutationFn: async () => {
      try {
        const res = await apiRequest("POST", "/api/jobs", form);
        return await res.json();
      } catch (e: any) {
        // apiRequest throws "<status>: <body>" on non-2xx. Parse the body if it's JSON.
        const raw = String(e?.message || "");
        const match = raw.match(/^(\d+):\s*(.*)$/s);
        let friendly: string | null = null;
        if (match) {
          try {
            const body = JSON.parse(match[2]);
            const fieldErrors = body?.error?.fieldErrors as Record<string, string[]> | undefined;
            friendly = fieldErrors
              ? String(Object.values(fieldErrors).flat()[0] || "")
              : typeof body?.error === "string"
                ? body.error
                : null;
          } catch {
            friendly = null;
          }
        }
        throw new Error(friendly || "Could not submit job post. Please check your inputs.");
      }
    },
    onSuccess: () => {
      setSubmitState({ kind: "ok" });
      setForm({
        title: "",
        business: "",
        address: "",
        phone: "",
        pay: "",
        body: "",
        submitterEmail: "",
      });
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      setSubmitState({ kind: "err", message: err.message });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitState({ kind: "idle" });
    submit.mutate();
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        desk="all"
        onDeskChange={() => {}}
        query=""
        onQueryChange={() => {}}
        onOpenSources={() => setSourcesOpen(true)}
        lastUpdatedLabel="Live"
      />
      <Weather />

      <main className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6 md:py-10">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            <Briefcase className="h-3 w-3" />
            ZooTown Jobs
          </span>
          <h1
            className="font-serif text-3xl font-semibold leading-tight md:text-4xl"
            data-testid="heading-jobs"
          >
            Who's hiring in Missoula
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A community job board. Local employers post directly — every listing
            is reviewed before it goes live. Keep it simple, keep it local.
          </p>
        </div>

        {/* Toolbar */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by job title, business, or keyword"
              data-testid="input-jobs-filter"
              className="w-full rounded-md border border-input bg-background py-2.5 pl-10 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </label>
          <button
            onClick={() => {
              setShowForm((s) => !s);
              setSubmitState({ kind: "idle" });
            }}
            data-testid="button-toggle-post-form"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            <Send className="h-3.5 w-3.5" />
            {showForm ? "Hide post form" : "Post a job"}
          </button>
        </div>

        {/* Post form */}
        {showForm && (
          <section
            aria-label="Post a job"
            className="mb-8 rounded-xl border border-card-border bg-card p-5"
            data-testid="section-post-job"
          >
            <h2 className="font-serif text-xl font-semibold tracking-tight">
              Post a job
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Free for local employers. Submissions are reviewed before they
              appear. We'll never publish your email or phone if you'd rather we
              didn't — just leave those fields blank.
            </p>

            {submitState.kind === "ok" ? (
              <div
                className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-foreground"
                data-testid="banner-job-submitted"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-medium">Thanks — your post is in the queue.</p>
                  <p className="mt-1 text-muted-foreground">
                    A moderator will review it shortly. If you need it taken
                    down or edited, contact the site admin.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Job title *"
                    placeholder="e.g. Part-time server"
                    value={form.title}
                    onChange={(v) => setForm({ ...form, title: v })}
                    required
                    testId="input-job-title"
                  />
                  <Field
                    label="Business / employer *"
                    placeholder="e.g. Top Hat Lounge"
                    value={form.business}
                    onChange={(v) => setForm({ ...form, business: v })}
                    required
                    testId="input-job-business"
                  />
                  <Field
                    label="Address (optional)"
                    placeholder="e.g. 134 W Front St, Missoula"
                    value={form.address}
                    onChange={(v) => setForm({ ...form, address: v })}
                    testId="input-job-address"
                  />
                  <Field
                    label="Phone (optional)"
                    placeholder="e.g. (406) 555-0123"
                    value={form.phone}
                    onChange={(v) => setForm({ ...form, phone: v })}
                    testId="input-job-phone"
                  />
                  <Field
                    label="Pay (optional)"
                    placeholder="e.g. $14/hr + tips, DOE"
                    value={form.pay}
                    onChange={(v) => setForm({ ...form, pay: v })}
                    testId="input-job-pay"
                  />
                  <Field
                    label="Your email (optional, for moderator)"
                    placeholder="we'll never publish this"
                    type="email"
                    value={form.submitterEmail}
                    onChange={(v) => setForm({ ...form, submitterEmail: v })}
                    testId="input-job-submitter-email"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="job-body"
                      className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Description *
                    </label>
                    <span
                      className={`font-mono text-[0.62rem] ${
                        wordCount > 1000 ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      {wordCount} / 1000 words
                    </span>
                  </div>
                  <textarea
                    id="job-body"
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    placeholder={BODY_PLACEHOLDER}
                    rows={12}
                    required
                    data-testid="input-job-body"
                    className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-relaxed outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                  />
                </div>

                {submitState.kind === "err" && (
                  <div
                    className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
                    data-testid="banner-job-error"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <span>{submitState.message}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover-elevate"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submit.isPending || wordCount > 1000}
                    data-testid="button-submit-job"
                    className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    {submit.isPending ? "Submitting…" : "Submit for review"}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* Listings */}
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-serif text-xl font-semibold tracking-tight">
            Open positions
          </h2>
          <span
            className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground"
            data-testid="text-jobs-count"
          >
            {jobsQuery.isLoading
              ? "Loading…"
              : `${filtered.length} listing${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {jobsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-border bg-card/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
            <Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-serif text-lg text-foreground">
              {jobs.length === 0
                ? "No jobs posted yet."
                : "Nothing matches that filter."}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {jobs.length === 0
                ? "Be the first — click \u201cPost a job\u201d to share an opening."
                : "Try a broader search term."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3" data-testid="list-jobs">
            {filtered.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-card-border bg-card p-5"
                data-testid={`card-job-${job.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-lg font-semibold leading-snug text-foreground">
                      {job.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="font-medium text-foreground">
                          {job.business}
                        </span>
                      </span>
                      {job.address && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {job.address}
                        </span>
                      )}
                      {job.phone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5" />
                          {job.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-right">
                    {job.pay && (
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {job.pay}
                      </span>
                    )}
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
                      {approvedDate(job)}
                    </span>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                  {job.body}
                </p>
              </li>
            ))}
          </ul>
        )}

        <footer className="mx-auto mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          ZooTown · Jobs · Community-posted, locally moderated. Not affiliated
          with any third-party job site.
        </footer>
      </main>

      <SourcesDialog open={sourcesOpen} onOpenChange={setSourcesOpen} />
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  required,
  type = "text",
  testId,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        data-testid={testId}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
      />
    </label>
  );
}
