import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskStatusBadge } from "@/components/planner/tasks/task-status-badge";
import { formatWorkload, type MemberWorkload } from "@/lib/planner/team/team-board";
import { MemberDetailView } from "./member-detail";
import type { MemberDetail } from "@/lib/planner/team/team-detail";

/** One labelled count in the collapsed strip. Overdue reads red only when > 0. */
function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn("text-base font-semibold", danger && value > 0 ? "text-red-600" : "text-ink-900")}>{value}</span>{" "}
      <span className="text-xs text-ink-500">{label}</span>
    </span>
  );
}

/**
 * A member "workspace" band. COLLAPSED = the Level-1 scan (name + counts + current
 * focus + workload + clients), a single scannable row. EXPANDED (in place, no
 * fetch) = the full read-only Level-2 detail. The whole header is a disclosure
 * button (aria-expanded / aria-controls); detail is computed by the island only
 * when open. Read-only throughout — no task controls.
 */
export function MemberBand({
  workload,
  detail,
  expanded,
  onToggle,
}: {
  workload: MemberWorkload;
  detail: MemberDetail | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { estimate, currentFocus } = workload;
  const detailId = `team-member-detail-${workload.id}`;
  return (
    <Card className="overflow-hidden">
      {/* Disclosure button holds only phrasing content (spans) so it stays valid
          HTML while remaining a native, keyboard-accessible <button>. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-ink-50/50"
      >
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-ink-400 transition-transform", expanded && "rotate-180")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-ink-900">{workload.name}</span>
            {workload.active === 0 ? <Badge tone="success">Available</Badge> : null}
          </span>

          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Stat label="active" value={workload.active} />
            <Stat label="due today" value={workload.scheduledToday} />
            <Stat label="overdue" value={workload.overdue} danger />
            <Stat label="waiting" value={workload.waiting} />
            <Stat label="clients" value={workload.clients} />
          </span>

          <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-ink-400">Focus:</span>
            {currentFocus ? (
              <>
                <span className="max-w-[18rem] truncate text-ink-700">{currentFocus.title}</span>
                {currentFocus.isOverdue ? (
                  <Badge tone="danger" dot>
                    Overdue
                  </Badge>
                ) : (
                  <TaskStatusBadge status={currentFocus.status} />
                )}
              </>
            ) : (
              <span className="text-ink-400">No active work</span>
            )}
          </span>

          <span className="mt-1 block text-xs text-ink-500">
            {estimate.estimatedMinutes != null ? (
              <>
                Workload: <span className="font-medium text-ink-700">{formatWorkload(estimate.estimatedMinutes)}</span>
              </>
            ) : (
              <span className="text-ink-400">No estimates yet</span>
            )}
            {estimate.noEstimateCount > 0 ? <span className="text-ink-400"> · {estimate.noEstimateCount} without estimate</span> : null}
            {workload.nextMeeting ? <span className="text-ink-400"> · Next meeting {workload.nextMeeting.whenLabel}</span> : null}
          </span>
        </span>
      </button>

      {expanded && detail ? (
        <div id={detailId} className="px-4 pb-4">
          <MemberDetailView detail={detail} />
        </div>
      ) : null}
    </Card>
  );
}
