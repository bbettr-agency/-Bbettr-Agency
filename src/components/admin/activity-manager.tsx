"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Eye, EyeOff, Files, History, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import {
  addActivityEventAction,
  deleteActivityEventAction,
  loadClientActivityAction,
} from "@/app/(admin)/admin/actions";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  selectRecent,
  ADMIN_RECENT_ROWS,
  type ActivityEventLike,
  type ActivityRowModel,
} from "@/components/admin/activity-presentation";

/**
 * Admin activity timeline (Slice 2B). The default view shows only the most
 * recent activity — with consecutive file uploads collapsed into a single
 * "N files uploaded" row so upload spam stops dominating the Work page. The
 * complete, ungrouped history (every event individually, with delete) loads on
 * demand behind "View full history". Adding curated milestones and deleting
 * individual events are unchanged.
 */
export function ActivityManager({
  clientId,
  events,
  hasMore,
}: {
  clientId: string;
  events: ActivityEventLike[];
  /** The bounded recent fetch hit its cap ⇒ more history exists on the server. */
  hasMore: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Full history is fetched on demand; null = not loaded (recent view).
  const [fullEvents, setFullEvents] = useState<ActivityEventLike[] | null>(null);
  const [loadingFull, startFullLoad] = useTransition();
  // Ids deleted this session, hidden from the loaded full list immediately.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const recent = selectRecent(events, ADMIN_RECENT_ROWS);
  const showHistoryButton = hasMore || recent.hasMoreRows;
  const inFullView = fullEvents !== null;

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    startTransition(async () => {
      const res = await addActivityEventAction(formData);
      if (!res.error) form.reset();
    });
  }

  function remove(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await deleteActivityEventAction(id, clientId);
      if (!res.error) {
        // Reflect the delete in the loaded full list right away; the recent
        // view refreshes from the server via revalidatePath.
        setDeletedIds((prev) => new Set(prev).add(id));
      }
      setBusyId(null);
    });
  }

  function openFullHistory() {
    startFullLoad(async () => {
      const all = await loadClientActivityAction(clientId);
      setFullEvents(all);
    });
  }

  const visibleFull = (fullEvents ?? []).filter((e) => !deletedIds.has(e.id));

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2 rounded-xl border border-ink-100 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input name="title" placeholder="Event title (e.g. Invoice Paid)" required />
          <Input name="occurred_at" type="date" className="sm:w-44" />
        </div>
        <Textarea name="description" placeholder="Optional detail…" rows={2} />
        <div className="flex items-center justify-between gap-2">
          <select
            name="visibility"
            defaultValue="client"
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="client">Client visible</option>
            <option value="internal">Internal only</option>
          </select>
          <Button type="submit" variant="outline" loading={pending}>
            <Plus className="h-4 w-4" /> Add event
          </Button>
        </div>
      </form>

      {events.length === 0 ? (
        <p className="text-sm text-ink-400">No activity yet.</p>
      ) : inFullView ? (
        /* FULL HISTORY — every event individually, ungrouped, deletable. */
        <div className="space-y-2">
          <ul className="space-y-2">
            {visibleFull.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                onDelete={remove}
                deleting={pending && busyId === ev.id}
              />
            ))}
          </ul>
          <button
            onClick={() => setFullEvents(null)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <ChevronUp className="h-4 w-4" /> Show recent only
          </button>
        </div>
      ) : (
        /* RECENT — grouped + limited; file-upload runs collapsed. */
        <div className="space-y-2">
          <ul className="space-y-2">
            {recent.rows.map((row) =>
              row.kind === "file_group" ? (
                <FileGroupRow key={row.id} row={row} />
              ) : (
                <EventRow
                  key={row.id}
                  event={row.event}
                  onDelete={remove}
                  deleting={pending && busyId === row.event.id}
                />
              )
            )}
          </ul>
          {showHistoryButton && (
            <button
              onClick={openFullHistory}
              disabled={loadingFull}
              className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
            >
              <History className="h-4 w-4" />
              {loadingFull ? "Loading…" : "View full history"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VisibilityIcon({ visibility }: { visibility: string }) {
  return (
    <span
      className="mt-0.5 shrink-0 text-ink-300"
      title={visibility === "internal" ? "Internal only" : "Client visible"}
    >
      {visibility === "internal" ? (
        <EyeOff className="h-4 w-4" />
      ) : (
        <Eye className="h-4 w-4 text-brand-500" />
      )}
    </span>
  );
}

function EventRow({
  event: ev,
  onDelete,
  deleting,
}: {
  event: ActivityEventLike;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-ink-100 p-3">
      <VisibilityIcon visibility={ev.visibility} />
      <div className="flex-1">
        <p className="text-sm font-medium text-ink-900">{ev.title}</p>
        {ev.description && <p className="text-xs text-ink-500">{ev.description}</p>}
        <p className="mt-0.5 text-xs text-ink-400">
          {format(new Date(ev.occurred_at), "d MMM yyyy")} · {ev.source}
        </p>
      </div>
      <button
        onClick={() => onDelete(ev.id)}
        disabled={deleting}
        className="shrink-0 text-ink-300 transition-colors hover:text-rose-500"
        title="Delete event"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Compressed row for a run of consecutive file uploads (recent view only). */
function FileGroupRow({ row }: { row: Extract<ActivityRowModel, { kind: "file_group" }> }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-3">
      <VisibilityIcon visibility={row.visibility} />
      <div className="flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
          <Files className="h-4 w-4 text-ink-400" />
          {row.count} files uploaded
        </p>
        <p className="mt-0.5 text-xs text-ink-400">
          {format(new Date(row.occurred_at), "d MMM yyyy")} · open full history to
          manage individually
        </p>
      </div>
    </li>
  );
}
