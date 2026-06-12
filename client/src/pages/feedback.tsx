import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useCity } from "@/lib/city-context";
import { MessageSquare, Check } from "lucide-react";

/**
 * Public feedback page at /feedback.
 *
 * Anyone can submit. We capture the optional fields they choose to share
 * (name, email, the page URL they came from, which city's feed they were
 * on). Submissions land in the `feedback` table and surface in the cockpit
 * sidebar for triage.
 *
 * The page URL is prefilled from a ?from= query param when the floating
 * "Feedback" button (see FeedbackButton component) navigates here -- that
 * way the admin can see exactly what page a user was on when they wrote.
 *
 * Rate limit (server-side): 5 submissions per IP per 10 minutes.
 */
export default function FeedbackPage() {
  const { currentCity } = useCity();
  const [, navigate] = useLocation();
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On mount, pull the ?from= query param so we know what page the user
  // was on when they clicked the Feedback button. We display it (and submit
  // it) so the admin can context-switch into it during triage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from) setPageUrl(from);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          citySlug: currentCity?.slug ?? undefined,
          pageUrl: pageUrl || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSubmittedId(data.id ?? 0);
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedId !== null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="rounded-full bg-emerald-500/15 p-4 text-emerald-500">
          <Check className="h-8 w-8" />
        </div>
        <h1 className="mt-6 font-serif text-3xl font-semibold">Thanks for the feedback.</h1>
        <p className="mt-3 text-muted-foreground">
          Your note is in front of us. If you left an email, we may get back to you.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href={`/${currentCity?.slug ?? "missoula"}`}>
            <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate">
              Back to {currentCity?.displayName ?? "ZooTown"}
            </a>
          </Link>
          <button
            type="button"
            onClick={() => {
              setSubmittedId(null);
              setBody("");
              setName("");
              setEmail("");
            }}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Submit another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-12">
      <Link href={`/${currentCity?.slug ?? "missoula"}`}>
        <a className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
          ← Back
        </a>
      </Link>
      <div className="mt-6 flex items-center gap-3">
        <div className="rounded-full bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h1 className="font-serif text-3xl font-semibold">Send feedback</h1>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Spot a bug, a wrong fact, a missing story, or a feature idea? Tell us. Every
        submission lands directly in our editorial cockpit and we read all of them.
      </p>

      {error && (
        <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
            What's on your mind? <span className="text-destructive">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            required
            minLength={5}
            maxLength={4000}
            placeholder="Type away. The more detail the better."
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[0.65rem] text-muted-foreground/70">
            {body.length} / 4000
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Your name <span className="opacity-50">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Email <span className="opacity-50">(optional, for a reply)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {pageUrl && (
          <div className="rounded-md border border-border/40 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            Referring page: <span className="font-mono text-foreground/80">{pageUrl}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-[0.65rem] text-muted-foreground/70">
            We don't track you. Your IP is used only for rate limiting (5 submissions per 10 minutes).
          </p>
          <button
            type="submit"
            disabled={submitting || body.trim().length < 5}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover-elevate disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </form>
    </main>
  );
}
