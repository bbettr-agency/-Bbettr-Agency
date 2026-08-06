import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TaskStatusBadge } from "@/components/planner/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/planner/tasks/task-priority-badge";
import { formatShortDate, type TeamTaskFacet } from "@/lib/planner/team/team-board";
import type { CompletedFacet } from "@/lib/planner/team/team-detail";

/**
 * READ-ONLY task row for the Team View Level-2 detail. This is the deliberate
 * line between Team View and My Tasks: there is NO command bar, NO action button,
 * NO mutation path — it is an observation row. Same data, inert presentation.
 */
export function TeamTaskRow({ facet }: { facet: TeamTaskFacet }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 truncate text-sm text-ink-800">{facet.title}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {facet.isOverdue ? (
          <Badge tone="danger" dot>
            Overdue
          </Badge>
        ) : facet.scheduledDate ? (
          <span className="text-xs text-ink-400">{formatShortDate(facet.scheduledDate)}</span>
        ) : null}
        {facet.priority === "critical" || facet.priority === "high" ? <TaskPriorityBadge priority={facet.priority} /> : null}
        <TaskStatusBadge status={facet.status} />
      </div>
    </li>
  );
}

/** Read-only completed-today row: a done tick, the title, and the completion time. */
export function CompletedTaskRow({ item }: { item: CompletedFacet }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span className="truncate text-sm text-ink-500">{item.title}</span>
      </span>
      <span className="shrink-0 text-xs text-ink-400">{item.completedAtLabel}</span>
    </li>
  );
}
