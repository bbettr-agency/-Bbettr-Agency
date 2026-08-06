import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskStatusBadge } from "@/components/planner/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/planner/tasks/task-priority-badge";
import { formatWorkload, type MemberWorkload } from "@/lib/planner/team/team-board";

/** A single labelled count. Overdue turns red only when there is something overdue. */
function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="whitespace-nowrap">
      <span className={cn("text-base font-semibold", danger && value > 0 ? "text-red-600" : "text-ink-900")}>{value}</span>{" "}
      <span className="text-xs text-ink-500">{label}</span>
    </div>
  );
}

/**
 * One admin's workload card. Real data only: counts, honest estimate rollup
 * (never a percentage; always the "without estimate" count), a deterministic
 * current focus (never a waiting task), and a next SCHEDULED meeting only when a
 * real one exists. No avatar — the brief calls for a low-clutter operational view.
 */
export function MemberCard({ member }: { member: MemberWorkload }) {
  const { estimate, currentFocus } = member;
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-ink-900">{member.name}</p>
          {member.active === 0 ? <Badge tone="success">Available</Badge> : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Stat label="active" value={member.active} />
          <Stat label="today" value={member.scheduledToday} />
          <Stat label="overdue" value={member.overdue} danger />
          <Stat label="in progress" value={member.inProgress} />
          <Stat label="waiting" value={member.waiting} />
        </div>

        <p className="mt-2 text-xs text-ink-500">
          {estimate.estimatedMinutes != null ? (
            <>
              Estimated workload: <span className="font-medium text-ink-700">{formatWorkload(estimate.estimatedMinutes)}</span>
            </>
          ) : (
            <span className="text-ink-400">No estimates yet</span>
          )}
          {estimate.noEstimateCount > 0 ? <span className="text-ink-400"> · {estimate.noEstimateCount} without estimate</span> : null}
        </p>

        <div className="mt-3 border-t border-ink-100 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Current focus</p>
          {currentFocus ? (
            <div className="mt-1">
              <p className="truncate text-sm text-ink-800">{currentFocus.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <TaskStatusBadge status={currentFocus.status} />
                <TaskPriorityBadge priority={currentFocus.priority} />
                {currentFocus.isOverdue ? (
                  <Badge tone="danger" dot>
                    Overdue
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-400">No active work</p>
          )}
        </div>

        {member.nextMeeting ? (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
            <span>
              Next scheduled meeting: <span className="text-ink-700">{member.nextMeeting.title}</span> · {member.nextMeeting.whenLabel}
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
