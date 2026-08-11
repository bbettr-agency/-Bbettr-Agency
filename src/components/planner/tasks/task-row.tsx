import { Repeat } from "lucide-react";
import { formatDayLabel } from "@/lib/planner/meetings/date-views";
import type { TaskView } from "@/lib/planner/tasks/task-view";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskPriorityBadge } from "./task-priority-badge";
import { TaskCommandControls } from "./task-command-controls";
import type { AssignChoices, TaskCommandTarget } from "./task-command-target";

/**
 * Shared Task Kit row (server-rendered, presentational). Consumes a `TaskView`
 * (never a raw Task) and renders real fields only — no empty placeholders. The
 * ONLY hydrating unit is the per-row `TaskCommandControls` island, which receives
 * just the minimal `TaskCommandTarget`. Reused by My Tasks now and by future
 * Today/Calendar/Team/Dashboard pages (they consume the kit, never the page).
 *
 * Layout mirrors the Inbox row: title + metadata primary on the left, subordinate
 * controls on the right; the controls' inline areas + feedback wrap to their own
 * full-width line, so a collapsed row stays compact.
 */
function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function TaskRow({ view, now, assign }: { view: TaskView; now: Date; assign?: AssignChoices }) {
  const target: TaskCommandTarget = { taskId: view.id, aggregateVersion: view.aggregateVersion, status: view.status, title: view.title };
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">{view.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            {view.isRecurring ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                <Repeat className="h-3 w-3" aria-hidden />
                Reminder{view.recurrenceLabel ? ` · ${view.recurrenceLabel}` : ""}
              </span>
            ) : null}
            <TaskStatusBadge status={view.status} />
            <TaskPriorityBadge priority={view.priority} />
            {view.isOverdue && view.dueDate ? (
              <span className="font-medium text-red-600">Overdue · due {formatDayLabel(view.dueDate, now)}</span>
            ) : view.dueDate ? (
              <span>Due {formatDayLabel(view.dueDate, now)}</span>
            ) : null}
            {view.scheduledDate ? <span>Scheduled {formatDayLabel(view.scheduledDate, now)}</span> : null}
            {view.estimatedMinutes != null ? <span>~{formatEstimate(view.estimatedMinutes)}</span> : null}
            {view.assigneeDisplay ? <span>· {view.assigneeDisplay}</span> : null}
          </div>
          {view.criticalReason ? <p className="mt-1 text-xs text-red-600">Critical: {view.criticalReason}</p> : null}
        </div>
        <TaskCommandControls target={target} assign={assign} />
      </div>
    </li>
  );
}
