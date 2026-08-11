import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskRow } from "@/components/planner/tasks/task-row";
import type { AssignChoices } from "@/components/planner/tasks/task-command-target";
import type { TodayGroup } from "@/lib/planner/today/today-grouping";

/** Today's task groups, rendered with the shared kit's TaskRow. Completed rows show
 *  no lifecycle controls (the kit returns no legal actions for completed tasks). */
export function TodayTasks({ groups, now, assign }: { groups: TodayGroup[]; now: Date; assign?: AssignChoices }) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.key}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>{g.label}</CardTitle>
            <span className="text-xs text-ink-500">{g.tasks.length}</span>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-ink-100">
              {g.tasks.map((v) => (
                <TaskRow key={v.id} view={v} now={now} assign={assign} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
