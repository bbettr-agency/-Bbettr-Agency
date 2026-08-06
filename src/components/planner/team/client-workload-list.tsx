import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStatusBadge } from "@/components/planner/tasks/task-status-badge";
import { formatWorkload, type ClientWorkload } from "@/lib/planner/team/team-board";

/**
 * Client Workload — active tasks grouped by REAL client_id only (never inferred
 * from a title). Tasks with no client fall under "Internal / No client", which the
 * board logic always sorts last. Shows honest counts, the assigned team members,
 * the current statuses, and the same estimate rollup rules as the member cards.
 */
export function ClientWorkloadList({ clients }: { clients: ClientWorkload[] }) {
  if (clients.length === 0) {
    return <p className="text-sm text-ink-500">No active client work matches these filters.</p>;
  }
  return (
    <div className="space-y-3">
      {clients.map((c) => (
        <Card key={c.clientId ?? "__internal__"}>
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">{c.name}</p>
                <p className="mt-0.5 truncate text-xs text-ink-500">{c.assignees.length > 0 ? c.assignees.join(", ") : "Unassigned"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-sm">
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-ink-900">{c.active}</span> <span className="text-ink-500">active</span>
                </span>
                <span className="whitespace-nowrap">
                  <span className={cn("font-semibold", c.overdue > 0 ? "text-red-600" : "text-ink-900")}>{c.overdue}</span>{" "}
                  <span className="text-ink-500">overdue</span>
                </span>
              </div>
            </div>

            {c.statuses.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {c.statuses.map((s) => (
                  <TaskStatusBadge key={s} status={s} />
                ))}
              </div>
            ) : null}

            <p className="mt-2 text-xs text-ink-500">
              {c.estimate.estimatedMinutes != null ? (
                <>
                  Estimated work: <span className="font-medium text-ink-700">{formatWorkload(c.estimate.estimatedMinutes)}</span>
                </>
              ) : (
                <span className="text-ink-400">No estimates yet</span>
              )}
              {c.estimate.noEstimateCount > 0 ? <span className="text-ink-400"> · {c.estimate.noEstimateCount} without estimate</span> : null}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
