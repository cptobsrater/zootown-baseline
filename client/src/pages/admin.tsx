import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Story, ModState } from "@shared/schema";
import {
  apiRequest,
  queryClient,
  getAdminToken,
  setAdminToken,
  subscribeAdminToken,
} from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { DeskBadge } from "@/components/DeskBadge";
import { AdminCityProvider, useAdminCity } from "@/lib/admin-city-context";
import { AdminCitySwitcher } from "@/components/admin/AdminCitySwitcher";
import { SourcesPanel } from "@/components/admin/SourcesPanel";
import { IngestLogPanel } from "@/components/admin/IngestLogPanel";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { EditStoryModal } from "@/components/admin/EditStoryModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { EditPatternsPanel } from "@/components/admin/EditPatternsPanel";
import { AddHistoryForm } from "@/components/admin/AddHistoryForm";
import { JobModerationPanel } from "@/components/admin/JobModerationPanel";
import { RulesPanel } from "@/components/admin/RulesPanel";
import { StoryInbox } from "@/components/admin/StoryInbox";
import { AuditsPanel } from "@/components/admin/AuditsPanel";
import { type DeskId, parseTags, relativeTime } from "@/lib/format";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  ShieldAlert,
  Inbox,
  Radio,
  ListOrdered,
  History,
  LogOut,
  Briefcase,
  Stethoscope,
} from "lucide-react";

type AdminSection = "inbox" | "moderation" | "sources" | "rules" | "log" | "patterns" | "history" | "jobs" | "audits";

const TABS: Array<{ id: ModState; label: string; intent: string }> = [
  { id: "draft", label: "Drafts", intent: "Awaiting review" },
  { id: "approved", label: "Approved", intent: "Published to live feed" },
  { id: "rejected", label: "Rejected", intent: "Not published — audit trail" },
];

interface StoriesPage {
  items: Story[];
  nextCursor: number | null;
  total: number;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(getAdminToken());

  useEffect(() => {
    const unsub = subscribeAdminToken((t) => setToken(t));
    return () => {
      unsub();
    };
  }, []);

  if (!token) {
    return <AdminLogin />;
  }

  return (
    <AdminCityProvider>
      <AdminInner />
    </AdminCityProvider>
  );
}

function AdminInner() {
  const { currentCity } = useAdminCity();
  const citySlug = currentCity.slug;
  const [section, setSection] = useState<AdminSection>("inbox");
  const [tab, setTab] = useState<ModState>("draft");
  const [editing, setEditing] = useState<Story | null>(null);
  const [deleting, setDeleting] = useState<Story | null>(null);

  const { data, isLoading } = useQuery<StoriesPage>({
    queryKey: ["/api/stories", { modState: tab, city: citySlug }],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("modState", tab);
      p.set("limit", "30");
      p.set("city", citySlug);
      const res = await apiRequest("GET", `/api/stories?${p.toString()}`);
      return (await res.json()) as StoriesPage;
    },
  });

  const mutate = useMutation({
    mutationFn: async ({ id, modState }: { id: number; modState: ModState }) => {
      const res = await apiRequest("PATCH", `/api/stories/${id}/mod`, { modState });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pulse"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/stories/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pulse"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/edits"] });
      setDeleting(null);
    },
  });

  async function logout() {
    try {
      await apiRequest("POST", "/api/admin/logout");
    } catch {
      /* ignore */
    }
    setAdminToken(null);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/${citySlug}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate"
              data-testid="link-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
            <Link href="/" data-testid="link-admin-landing" aria-label="ZooTown home">
              <Wordmark />
            </Link>
            <AdminCitySwitcher />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/cockpit-live" data-testid="link-cockpit-live">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
                Live cockpit →
              </a>
            </Link>
            <Link href="/admin/rules-queue" data-testid="link-rules-queue">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate">
                Learning rules →
              </a>
            </Link>
            <Link href="/admin/x-unmapped" data-testid="link-x-unmapped">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate">
                X authors →
              </a>
            </Link>
            <Link href="/admin/synthesis-queue" data-testid="link-synthesis-queue">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
                Synthesis queue →
              </a>
            </Link>
            <Link href="/admin/event-quarantine" data-testid="link-event-quarantine">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
                Event quarantine →
              </a>
            </Link>
            <Link href="/admin/cockpit" data-testid="link-cockpit">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate">
                Classic →
              </a>
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-destructive">
              <ShieldAlert className="h-3 w-3" />
              Internal · Moderation
            </div>
            <button
              onClick={logout}
              data-testid="button-admin-logout"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[1.9rem] font-semibold tracking-tight">
              {section === "inbox" && "Story Inbox"}
              {section === "moderation" && "Moderation Queue (legacy)"}
              {section === "sources" && "Sources & Health"}
              {section === "log" && "Ingest Log"}
              {section === "patterns" && "Override Patterns"}
              {section === "history" && "History Pool"}
              {section === "jobs" && "Job Posts"}
              {section === "audits" && "Editorial Audits"}
              {section === "rules" && "Classification Rules"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              {section === "inbox" &&
                "Everything published to the site — newest first. Click a row to edit. Hit Approve to mark a story as reviewed (still live, plus used as a learning signal)."}
              {section === "moderation" &&
                "Legacy draft/approved/rejected workflow. The new Inbox is what you'll mostly use."}
              {section === "sources" &&
                `Every watched ${currentCity.displayName} source. Add new sources with a live-test preview, run on demand, or remove sources that aren't pulling their weight.`}
              {section === "log" &&
                "Every ingestion run the scheduler has performed — live fetches, fixtures fallbacks, dedupes, and cross-source clusters. Updates every 10 seconds."}
              {section === "patterns" &&
                "Recent manual overrides — these patterns inform parser fixes (not ML training). When a source consistently misclassifies, the parser gets patched."}
              {section === "rules" &&
                "Active classification rules + suggestions surfaced from your repeated edits."}
            </p>
          </div>
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1 text-xs">
            <SectionTab active={section === "inbox"} onClick={() => setSection("inbox")} icon={<Inbox className="h-3.5 w-3.5" />} label="Inbox" testId="admin-section-inbox" />
            <SectionTab active={section === "moderation"} onClick={() => setSection("moderation")} icon={<Inbox className="h-3.5 w-3.5" />} label="Legacy Mod" testId="admin-section-moderation" />
            <SectionTab active={section === "sources"} onClick={() => setSection("sources")} icon={<Radio className="h-3.5 w-3.5" />} label="Sources" testId="admin-section-sources" />
            <SectionTab active={section === "rules"} onClick={() => setSection("rules")} icon={<History className="h-3.5 w-3.5" />} label="Rules" testId="admin-section-rules" />
            <SectionTab active={section === "log"} onClick={() => setSection("log")} icon={<ListOrdered className="h-3.5 w-3.5" />} label="Ingest log" testId="admin-section-log" />
            <SectionTab active={section === "patterns"} onClick={() => setSection("patterns")} icon={<History className="h-3.5 w-3.5" />} label="Overrides" testId="admin-section-patterns" />
            <SectionTab active={section === "history"} onClick={() => setSection("history")} icon={<History className="h-3.5 w-3.5" />} label="History Pool" testId="admin-section-history" />
            <SectionTab active={section === "jobs"} onClick={() => setSection("jobs")} icon={<Briefcase className="h-3.5 w-3.5" />} label="Job posts" testId="admin-section-jobs" />
            <SectionTab active={section === "audits"} onClick={() => setSection("audits")} icon={<Stethoscope className="h-3.5 w-3.5" />} label="Audits" testId="admin-section-audits" />
          </div>
        </div>

        {section === "inbox" && <StoryInbox />}
        {section === "sources" && <SourcesPanel />}
        {section === "log" && <IngestLogPanel />}
        {section === "patterns" && <EditPatternsPanel />}
        {section === "history" && <AddHistoryForm />}
        {section === "rules" && <RulesPanel />}
        {section === "jobs" && <JobModerationPanel />}
        {section === "audits" && <AuditsPanel />}

        {section === "moderation" && (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  data-testid={`admin-tab-${t.id}`}
                  className={`rounded-lg border px-4 py-3 text-left hover-elevate ${
                    tab === t.id ? "border-foreground/20 bg-secondary/60" : "border-card-border bg-card"
                  }`}
                >
                  <div className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                    {t.label}
                  </div>
                  <div className="mt-1 font-serif text-[1.4rem] font-semibold">
                    {tab === t.id ? data?.total ?? "—" : "—"}
                  </div>
                  <div className="text-[0.72rem] text-muted-foreground">{t.intent}</div>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-card-border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
                  {tab} items
                </div>
                <div className="text-xs text-muted-foreground">
                  {isLoading ? "Loading…" : `${data?.items.length ?? 0} shown`}
                </div>
              </div>

              {isLoading && <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>}

              {!isLoading && (data?.items.length ?? 0) === 0 && (
                <div className="p-10 text-center">
                  <p className="font-serif text-lg">Queue is empty.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nothing in the {tab} queue right now.
                  </p>
                </div>
              )}

              <ul className="divide-y divide-border">
                {(data?.items ?? []).map((s) => (
                  <AdminRow
                    key={s.id}
                    story={s}
                    onApprove={() => mutate.mutate({ id: s.id, modState: "approved" })}
                    onReject={() => mutate.mutate({ id: s.id, modState: "rejected" })}
                    onSendToDraft={() => mutate.mutate({ id: s.id, modState: "draft" })}
                    onEdit={() => setEditing(s)}
                    onDelete={() => setDeleting(s)}
                    disabled={mutate.isPending}
                    currentTab={tab}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </main>

      {editing && <EditStoryModal story={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <ConfirmDialog
          title={`Delete story #${deleting.id}?`}
          body={`"${deleting.headline}" will be permanently removed. This cannot be undone.`}
          confirmLabel="Delete permanently"
          destructive
          busy={deleteMut.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMut.mutate(deleting.id)}
          testIdConfirm="button-confirm-delete-story"
        />
      )}
    </div>
  );
}

function SectionTab({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
        active
          ? "bg-secondary text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function AdminRow({
  story,
  onApprove,
  onReject,
  onSendToDraft,
  onEdit,
  onDelete,
  disabled,
  currentTab,
}: {
  story: Story;
  onApprove: () => void;
  onReject: () => void;
  onSendToDraft: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  currentTab: ModState;
}) {
  const tags = parseTags(story.tags);
  const riskStyle =
    story.riskLevel === "high"
      ? "bg-destructive/12 text-destructive border border-destructive/25"
      : story.riskLevel === "medium"
      ? "bg-[hsl(var(--desk-business))]/12 text-[hsl(var(--desk-business))] border border-[hsl(var(--desk-business))]/25"
      : "bg-secondary/60 text-muted-foreground border border-border";
  return (
    <li className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <DeskBadge desk={story.desk as DeskId} />
          <span className="text-[0.62rem] font-mono text-muted-foreground">·</span>
          <span className="text-xs font-mono text-muted-foreground">
            {relativeTime(story.publishedAt)}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.1em] ${riskStyle}`}
          >
            risk · {story.riskLevel}
          </span>
        </div>
        <h3 className="mt-2 font-serif text-[1.02rem] font-semibold text-foreground leading-snug">
          {story.headline}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{story.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
          <span>{story.sourceName}</span>
          <span>·</span>
          <span>{story.sourceType}</span>
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="font-mono uppercase tracking-[0.12em]">
              #{t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          onClick={onEdit}
          disabled={disabled}
          data-testid={`button-edit-${story.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover-elevate active-elevate-2 disabled:opacity-60"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
        {currentTab !== "approved" && (
          <button
            onClick={onApprove}
            disabled={disabled}
            data-testid={`button-approve-${story.id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </button>
        )}
        {currentTab !== "rejected" && (
          <button
            onClick={onReject}
            disabled={disabled}
            data-testid={`button-reject-${story.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover-elevate active-elevate-2 disabled:opacity-60"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
        )}
        {currentTab !== "draft" && (
          <button
            onClick={onSendToDraft}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover-elevate disabled:opacity-60"
          >
            Send to draft
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={disabled}
          data-testid={`button-delete-${story.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive hover-elevate active-elevate-2 disabled:opacity-60"
          title="Delete permanently"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </li>
  );
}
