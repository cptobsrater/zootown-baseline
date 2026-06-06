import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2,
  XCircle,
  Trash2,
  MapPin,
  Phone,
  Mail,
  Building2,
  Clock,
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

interface JobsAdminResponse {
  jobs: JobPost[];
  counts: { pending: number; approved: number; rejected: number };
}

type Tab = "pending" | "approved" | "rejected";

const TABS: Array<{ id: Tab; label: string; intent: string }> = [
  { id: "pending", label: "Pending", intent: "Awaiting your review" },
  { id: "approved", label: "Approved", intent: "Live on the jobs page" },
  { id: "rejected", label: "Rejected", intent: "Hidden from public, audit trail" },
];

export function JobModerationPanel() {
  const [tab, setTab] = useState<Tab>("pending");
  const qc = useQueryClient();

  const query = useQuery<JobsAdminResponse>({
    queryKey: ["/api/admin/jobs", tab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/jobs?state=${tab}`);
      return (await res.json()) as JobsAdminResponse;
    },
  });

  const setState = useMutation({
    mutationFn: async ({ id, state }: { id: number; state: Tab }) => {
      const res = await apiRequest("PATCH", `/api/admin/jobs/${id}`, { state });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/jobs/${id}`);
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });

  const jobs = query.data?.jobs ?? [];
  const counts = query.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };

  return (
    <div>
      {/* Tabs */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`admin-jobs-tab-${t.id}`}
            className={`rounded-lg border p-3 text-left transition-colors ${
              tab === t.id
                ? "border-foreground/40 bg-card"
                : "border-border bg-background hover-elevate"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                {t.label}
              </span>
              <span className="font-serif text-xl font-semibold tabular-nums">
                {counts[t.id]}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t.intent}</div>
          </button>
        ))}
      </div>

      {/* Listings */}
      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-card/40"
            />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
          No {tab} job posts.
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="rounded-xl border border-card-border bg-card p-5"
              data-testid={`admin-job-${job.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-lg font-semibold leading-snug text-foreground">
                    {job.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      {job.business}
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
                    {job.submitterEmail && (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        {job.submitterEmail}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.14em]">
                      <Clock className="h-3 w-3" />
                      {new Date(job.submittedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                {job.pay && (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {job.pay}
                  </span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed text-foreground/85">
                {job.body}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {tab !== "approved" && (
                  <button
                    onClick={() => setState.mutate({ id: job.id, state: "approved" })}
                    disabled={setState.isPending}
                    data-testid={`button-approve-${job.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </button>
                )}
                {tab !== "rejected" && (
                  <button
                    onClick={() => setState.mutate({ id: job.id, state: "rejected" })}
                    disabled={setState.isPending}
                    data-testid={`button-reject-${job.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Delete this job post permanently?`)) {
                      remove.mutate(job.id);
                    }
                  }}
                  disabled={remove.isPending}
                  data-testid={`button-delete-${job.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
