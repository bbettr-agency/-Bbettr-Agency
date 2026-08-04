import { AlertCircle, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getMyTasks } from "@/lib/planner/tasks/read-adapters";
import { listAdminTeam } from "@/lib/planner/team";
import { toTaskView } from "@/lib/planner/tasks/task-view";
import { groupMyTasks } from "@/lib/planner/tasks/my-tasks-grouping";
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
import { TaskRow } from "./task-row";

/**
 * My Tasks — the admin's canonical personal task workspace (first consumer of the
 * shared Task Kit). Server Component: the task read is authoritative; team names
 * are OPTIONAL best-effort enrichment resolved in ONE batched lookup (no per-task
 * query, no N+1) — a name failure must never blank the list. Grouping is
 * deterministic single-placement (Overdue → In Progress → Scheduled → Planned →
 * Waiting/Blocked); overdue is derived. Only the per-row command controls hydrate.
 */
export async function MyTasksList() {
  const [tasksResult, teamResult] = await Promise.allSettled([getMyTasks(), listAdminTeam()]);

  if (tasksResult.status === "rejected") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <AlertCircle className="h-4 w-4 text-ink-400" />
          <span>Couldn&rsquo;t load your tasks right now. Refresh to try again.</span>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const today = todayDate(now, AGENCY_TZ);

  // Best-effort id→name map (one lookup, not per-task); a failure just omits names.
  const nameById = new Map<string, string>();
  if (teamResult.status === "fulfilled") {
    for (const m of teamResult.value) nameById.set(m.id, m.fullName);
  }

  const views = tasksResult.value.map((t) => toTaskView(t, nameById, today));
  const groups = groupMyTasks(views);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No active tasks"
        description="Nothing on your plate right now. Capture work in the Inbox, then triage it here."
      />
    );
  }

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
                <TaskRow key={v.id} view={v} now={now} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
