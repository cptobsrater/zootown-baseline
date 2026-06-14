/**
 * Phase 24: per-story feedback bar.
 *
 * Three buttons next to the source link: thumbs-up, thumbs-down, flag.
 * Optimistic UI; talks to /api/signals on every interaction. Counts are
 * tiny and muted by default; they're not the point of the card.
 *
 * Reports open a small inline form (no modal): pick a reason, optional
 * comment, required email. Email is the only friction in the feedback
 * flow and only for reports \u2014 we use it to reach out for context if
 * something looks like a real editorial issue, not to spam the user.
 */
import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Flag, X, Loader2 } from "lucide-react";

interface Aggregates {
  views: number;
  likes: number;
  dislikes: number;
  shares: number;
  reports: number;
  brigadeFlag: boolean;
}
interface UserState {
  liked: boolean;
  disliked: boolean;
  shared: boolean;
  reported: boolean;
}

interface Props {
  storyId: number;
  citySlug?: string;
  // Pre-loaded from the feed query so the row renders without a per-card fetch.
  initialAggregates?: Aggregates;
  initialUserState?: UserState;
}

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "misleading", label: "Misleading or wrong" },
  { value: "wrong_city", label: "Wrong city" },
  { value: "too_political", label: "Too political / divisive" },
  { value: "duplicate", label: "Duplicate of another story" },
  { value: "offensive", label: "Offensive or harmful" },
  { value: "other", label: "Something else" },
];

export function FeedbackBar({ storyId, citySlug, initialAggregates, initialUserState }: Props) {
  const [aggs, setAggs] = useState<Aggregates>(
    initialAggregates ?? { views: 0, likes: 0, dislikes: 0, shares: 0, reports: 0, brigadeFlag: false },
  );
  const [user, setUser] = useState<UserState>(
    initialUserState ?? { liked: false, disliked: false, shared: false, reported: false },
  );
  const [pending, setPending] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Hydrate on mount if no initial props were supplied. Keeps the
  // component self-sufficient even when the feed query hasn't fetched
  // aggregates yet.
  useEffect(() => {
    if (initialAggregates) return;
    let cancelled = false;
    fetch(`/api/signals?ids=${storyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.aggregates?.[storyId]) setAggs(data.aggregates[storyId]);
        if (data?.userState?.[storyId]) setUser(data.userState[storyId]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  async function postSignal(body: Record<string, unknown>) {
    const res = await fetch("/api/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ storyId, citySlug, ...body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error ?? `signal failed (${res.status})`);
    }
    const data = await res.json();
    if (data?.aggregates) setAggs(data.aggregates);
    if (data?.userState) setUser(data.userState);
    return data;
  }

  async function handleLike() {
    if (pending) return;
    setPending("like");
    try {
      await postSignal({ action: user.liked ? "unlike" : "like" });
    } catch (e) {
      console.warn(e);
    } finally {
      setPending(null);
    }
  }

  async function handleDislike() {
    if (pending) return;
    setPending("dislike");
    try {
      await postSignal({ action: user.disliked ? "undislike" : "dislike" });
    } catch (e) {
      console.warn(e);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={handleLike}
        disabled={!!pending}
        aria-pressed={user.liked}
        title={user.liked ? "Remove like" : "Like this story"}
        data-testid={`signal-like-${storyId}`}
        className={`group inline-flex items-center gap-1 transition-colors ${
          user.liked ? "text-foreground" : "hover:text-foreground"
        }`}
      >
        <ThumbsUp className={`h-3.5 w-3.5 ${user.liked ? "fill-current" : ""}`} />
        {aggs.likes > 0 && <span className="tabular-nums">{aggs.likes}</span>}
      </button>

      <button
        type="button"
        onClick={handleDislike}
        disabled={!!pending}
        aria-pressed={user.disliked}
        title={user.disliked ? "Remove dislike" : "Dislike this story"}
        data-testid={`signal-dislike-${storyId}`}
        className={`group inline-flex items-center gap-1 transition-colors ${
          user.disliked ? "text-foreground" : "hover:text-foreground"
        }`}
      >
        <ThumbsDown className={`h-3.5 w-3.5 ${user.disliked ? "fill-current" : ""}`} />
        {aggs.dislikes > 0 && <span className="tabular-nums">{aggs.dislikes}</span>}
      </button>

      <button
        type="button"
        onClick={() => setReportOpen((o) => !o)}
        disabled={user.reported}
        title={user.reported ? "You reported this story" : "Report a problem"}
        data-testid={`signal-report-${storyId}`}
        className={`inline-flex items-center gap-1 transition-colors ${
          user.reported ? "text-amber-600" : "hover:text-amber-600"
        }`}
      >
        <Flag className={`h-3.5 w-3.5 ${user.reported ? "fill-current" : ""}`} />
        {aggs.reports > 0 && <span className="tabular-nums">{aggs.reports}</span>}
      </button>

      {reportOpen && !user.reported && (
        <ReportForm
          onCancel={() => setReportOpen(false)}
          onSubmit={async (payload) => {
            try {
              await postSignal({ action: "report", ...payload });
              setReportOpen(false);
            } catch (e: any) {
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

interface ReportFormProps {
  onCancel: () => void;
  onSubmit: (payload: { reason: string; comment?: string; reporterEmail: string }) => Promise<void>;
}

function ReportForm({ onCancel, onSubmit }: ReportFormProps) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].value);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Please enter a valid email so we can follow up if needed.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ reason, comment: comment.trim() || undefined, reporterEmail: email });
    } catch (e: any) {
      setError(e?.message ?? "Could not submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-card-border bg-card p-5 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-xl">Report this story</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Your email lets us follow up if we need context. It's not published.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 hover-elevate text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              What's wrong?
            </span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-sm"
            >
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              Details (optional)
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What stood out to you?"
              className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              Your email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-sm"
            />
          </label>

          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-xs hover-elevate"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover-elevate disabled:opacity-50"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Sending...
              </span>
            ) : (
              "Send report"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
