"use client";

/**
 * Weekly Updates board — the ONE small client island. It holds the member-filter
 * and search state and re-derives everything from server-provided, presentation-safe
 * `WeeklyUpdateItem`s via the pure `computeWeekly`. It fetches NOTHING: the item
 * list, member list, client picker and every date label arrive baked from the
 * server, so SSR == first client render (no hydration drift).
 *
 * Delete is exposed only on the viewer's OWN manual entries (`canDelete`), calls
 * the author-only Server Action, then refreshes. Adding a manual update is hosted
 * here via <AddUpdateForm/>; both mutations round-trip through the server so the
 * automatic (task) rows stay authoritative and read-only.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { computeWeekly, totalItems, type WeeklyUpdateItem } from "@/lib/planner/weekly/weekly-board";
import { deleteWeeklyUpdateAction } from "@/app/(admin)/admin/planner/weekly-updates/actions";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberUpdatesCard } from "./member-updates-card";
import { AddUpdateForm } from "./add-update-form";

export function WeeklyBoard({
  items,
  members,
  pickerClients,
  defaultDate,
}: {
  items: WeeklyUpdateItem[];
  members: { id: string; name: string }[];
  pickerClients: { id: string; name: string }[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const groups = useMemo(() => computeWeekly(items, { memberId, search }), [items, memberId, search]);
  const shown = totalItems(groups);

  async function onDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await deleteWeeklyUpdateAction({ id });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-48">
            <Label htmlFor="wu-member-filter">Team member</Label>
            <Select id="wu-member-filter" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="all">Everyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-64">
            <Label htmlFor="wu-search">Search</Label>
            <Input
              id="wu-search"
              type="search"
              value={search}
              placeholder="What or which client…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <AddUpdateForm clients={pickerClients} defaultDate={defaultDate} />

      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No completed work recorded for this week"
          description="Completed Planner tasks will appear here automatically, or add a manual update."
        />
      ) : shown === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-8 text-center text-sm text-ink-500">
          Nothing matches these filters.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <MemberUpdatesCard key={g.memberId} group={g} onDelete={onDelete} deletingId={deletingId} />
          ))}
        </div>
      )}
    </div>
  );
}
