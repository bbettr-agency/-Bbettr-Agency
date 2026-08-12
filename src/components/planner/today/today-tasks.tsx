import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskRow } from "@/components/planner/tasks/task-row";
import type { AssignChoices } from "@/components/planner/tasks/task-command-target";
import type { TodayGroup } from "@/lib/planner/today/today-grouping";

/**
 * Today's task sections, each a full-width Card rendered with the shared kit's
 * TaskRow (fully actionable — Complete + Actions ▾, Edit, Assign, etc.). Sections
 * flagged `alwaysShow` render even when empty (with their `emptyLabel`) so the day
 * reads at a glance; Waiting/Blocked appears only when it has tasks. Completed rows
 * show no lifecycle controls (the kit returns no legal actions for completed).
 */
export function TodayTasks({ groups, now, assign }: { groups: TodayGroup[]; now: Date; assign?: AssignChoices }) {
  const visible = groups.filter((g) => g.alwaysShow || g.tasks.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="space-y-4">
      {visible.map((g) => (
        <Card key={g.key}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>{g.label}</CardTitle>
            <span className="text-xs text-ink-500">{g.tasks.length}</span>
          </CardHeader>
          <CardContent>
            {g.tasks.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {g.tasks.map((v) => (
                  <TaskRow key={v.id} view={v} now={now} assign={assign} />
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-ink-500">{g.emptyLabel}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
