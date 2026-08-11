import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { INTERNAL_CLIENT_LABEL, type MemberUpdates, type WeeklyUpdateItem } from "@/lib/planner/weekly/weekly-board";

/** One accomplished item: a completed task (✓) or a manual note (•, tagged "Manual"). */
function ItemRow({ it, onDelete, deleting }: { it: WeeklyUpdateItem; onDelete: (id: string) => void; deleting: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        {it.source === "task" ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-800">{it.text}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
            <span className="truncate">{it.clientName ?? INTERNAL_CLIENT_LABEL}</span>
            <span className="text-ink-300">·</span>
            <span>{it.dateLabel}</span>
            {it.source === "manual" ? (
              <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                Manual
              </Badge>
            ) : null}
          </p>
        </div>
      </div>
      {it.canDelete ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 text-ink-400 hover:text-red-600"
          disabled={deleting}
          loading={deleting}
          aria-busy={deleting || undefined}
          onClick={() => onDelete(it.id)}
          aria-label={`Delete update “${it.text}”`}
        >
          Delete
        </Button>
      ) : null}
    </li>
  );
}

/** A member's accomplishments for the week (read-only tasks + their own manual notes). */
export function MemberUpdatesCard({
  group,
  onDelete,
  deletingId,
}: {
  group: MemberUpdates;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">{group.memberName}</CardTitle>
        <span className="text-xs text-ink-500">{group.count} completed</span>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-ink-100">
          {group.items.map((it) => (
            <ItemRow key={`${it.source}-${it.id}`} it={it} onDelete={onDelete} deleting={deletingId === it.id} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
