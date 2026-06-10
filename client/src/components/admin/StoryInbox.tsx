/**
 * Story Inbox — the new admin landing area for reviewing all published stories.
 *
 * Two timestamped lists, newest first:
 *   - Unreviewed: everything that hasn't been signed off yet (still live on the site)
 *   - Reviewed:   stories you've manually verified (still live; act as learning tokens)
 *
 * Each row exposes point-and-click edit (headline, summary, desk, source, event fields),
 * and "Approve" / "Move back to unreviewed" toggle.
 *
 * Events (desk='events') appear here too — editing one switches it between news feed
 * and community calendar by changing the desk.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Story } from "@shared/schema";
import { EditStoryModal } from "./EditStoryModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CheckCircle2, Undo2, Pencil, Trash2, Loader2, Calendar } from "lucide-react";

type Tab = "unreviewed" | "reviewed";

interface StoriesPage {
  items: Story[];
  total: number;
  nextCursor: number | null;
}

export function StoryInbox() {
  const [tab, setTab] = useState<Tab>("unreviewed");
  const [editing, setEditing] = useState<Story | null>(null);
  const [deleting, setDeleting] = useState<Story | null>(null);

  const isReviewed = tab === "reviewed";

  const { data, isLoading } = useQuery<StoriesPage>({
    queryKey: ["/api/stories", { isReviewed, inbox: true }],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("isReviewed", String(isReviewed));
      p.set("limit", "50");
      p.set("modState", "all");
      p.set("includeEvents", "true"); // events show in the inbox too
      const res = await apiRequest("GET", `/api/stories?${p.toString()}`);
      return (await res.json()) as StoriesPage;
    },
  });

  const reviewMut = useMutation({
    mutationFn: async ({ id, isReviewed: r }: { id: number; isReviewed: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/stories/${id}/review`, { isReviewed: r });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/edits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/suggested-rules"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/stories/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setDeleting(null);
    },
  });

  return (
    <>
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1 text-xs">
        <TabBtn active={tab === "unreviewed"} onClick={() => setTab("unreviewed")}>
          Unreviewed
        </TabBtn>
        <TabBtn active={tab === "reviewed"} onClick={() => setTab("reviewed")}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Reviewed
        </TabBtn>
      </div>

      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted-foreground">
            {tab === "unreviewed"
              ? "Published & awaiting review — newest first"
              : "Reviewed — your approved set, used as learning tokens"}
          </div>
          <div className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${data?.items.length ?? 0} of ${data?.total ?? 0}`}
          </div>
        </div>

        {isLoading && (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}

        {!isLoading && (data?.items.length ?? 0) === 0 && (
          <div className="p-10 text-center">
            <p className="font-serif text-lg">Nothing here.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "unreviewed"
                ? "All caught up — no unreviewed stories."
                : "You haven't approved any stories yet. Hit Approve on an Unreviewed row."}
            </p>
          </div>
        )}

        <ul className="divide-y divide-border">
          {(data?.items ?? []).map((s) => (
            <InboxRow
              key={s.id}
              story={s}
              isReviewed={isReviewed}
              busy={reviewMut.isPending}
              onApprove={() => reviewMut.mutate({ id: s.id, isReviewed: true })}
              onUnapprove={() => reviewMut.mutate({ id: s.id, isReviewed: false })}
              onEdit={() => setEditing(s)}
              onDelete={() => setDeleting(s)}
            />
          ))}
        </ul>
      </div>

      {editing && <EditStoryModal story={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <ConfirmDialog
          title={`Delete #${deleting.id}?`}
          body={`"${deleting.headline}" will be permanently removed. This cannot be undone.`}
          confirmLabel="Delete permanently"
          destructive
          busy={deleteMut.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMut.mutate(deleting.id)}
          testIdConfirm="button-confirm-delete-inbox"
        />
      )}
    </>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
        active
          ? "bg-secondary text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function InboxRow({
  story,
  isReviewed,
  busy,
  onApprove,
  onUnapprove,
  onEdit,
  onDelete,
}: {
  story: Story;
  isReviewed: boolean;
  busy: boolean;
  onApprove: () => void;
  onUnapprove: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isEvent = story.desk === "events";
  const timestamp = new Date(story.publishedAt);
  const time = isNaN(timestamp.getTime())
    ? "—"
    : timestamp.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <li className="p-4 hover:bg-secondary/30 transition-colors" data-testid={`inbox-row-${story.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <DeskBadge desk={story.desk} />
            {isEvent && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[0.62rem] font-mono uppercase tracking-wide text-muted-foreground">
                <Calendar className="h-3 w-3" /> On calendar
              </span>
            )}
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              #{story.id} · {time}
            </span>
          </div>
          <h3
            className="font-serif text-base font-semibold leading-snug cursor-pointer hover:underline"
            onClick={onEdit}
            data-testid={`text-headline-${story.id}`}
          >
            {story.headline}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{story.summary}</p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[0.7rem] text-muted-foreground">
            <span>{story.sourceName}</span>
            {story.sourceUrl && (
              <>
                <span>·</span>
                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  source link
                </a>
              </>
            )}
            {isEvent && story.venue && (
              <>
                <span>·</span>
                <span>{story.venue}</span>
              </>
            )}
            {isEvent && story.startsAt && (
              <>
                <span>·</span>
                <span>
                  {new Date(story.startsAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <IconBtn label="Edit" onClick={onEdit} disabled={busy} testId={`button-edit-${story.id}`}>
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
          {isReviewed ? (
            <IconBtn
              label="Move back to Unreviewed"
              onClick={onUnapprove}
              disabled={busy}
              testId={`button-unreview-${story.id}`}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </IconBtn>
          ) : (
            <ApproveBtn
              onClick={onApprove}
              disabled={busy}
              testId={`button-approve-${story.id}`}
            />
          )}
          <IconBtn
            label="Delete"
            onClick={onDelete}
            disabled={busy}
            testId={`button-delete-${story.id}`}
            destructive
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>
    </li>
  );
}

function DeskBadge({ desk }: { desk: string }) {
  return (
    <span
      className="inline-flex rounded-md border px-1.5 py-0.5 text-[0.62rem] font-mono uppercase tracking-wide"
      style={{
        backgroundColor: `hsl(var(--desk-${desk}) / 0.12)`,
        color: `hsl(var(--desk-${desk}))`,
        borderColor: `hsl(var(--desk-${desk}) / 0.3)`,
      }}
    >
      {desk}
    </span>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
  destructive,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  destructive?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      data-testid={testId}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background hover-elevate disabled:opacity-50 ${
        destructive ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ApproveBtn({
  onClick,
  disabled,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-[0.7rem] font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
    >
      {disabled ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      Approve
    </button>
  );
}
