import { AlertCircle, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { getMyTasks } from "@/lib/planner/tasks/read-adapters";
import { listAdminTeam } from "@/lib/planner/team";
import { toTaskView } from "@/lib/planner/tasks/task-view";
import { groupMyTasks } from "@/lib/planner/tasks/my-tasks-grouping";
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
import { TaskRow } from "./task-row";
import type { AssignChoices } from "./task-command-target";

/**
 * My Tasks — the admin's canonical personal task workspace (first consumer of the
 * shared Task Kit). Server Component: the task read is authoritative; team names
 * are OPTIONAL best-effort enrichment resolved in ONE batched lookup (no per-task
 * query, no N+1) — a name failure must never blank the list. Grouping is
 * deterministic single-placement (Overdue → In Progress → Scheduled → Planned →
 * Waiting/Blocked); overdue is derived. Only the per-row command controls hydrate.
 */
export async function MyTasksList() {
  const [tasksResult, teamResult, profile] = await Promise.all([
    getMyTasks().then((v) => ({ status: "fulfilled" as const, value: v })).catch((e) => ({ status: "rejected" as const, reason: e })),
    listAdminTeam().then((v) => v).catch(() => []),
    getCurrentProfile(),
  ]);

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
  const nameById = new Map(teamResult.map((m) => [m.id, m.fullName]));
  // Assign choices — the workspace admins + the acting admin (for the "Me" label).
  const assign: AssignChoices | undefined = profile
    ? { admins: teamResult.map((m) => ({ id: m.id, name: m.fullName })), currentAdminId: profile.id }
    : undefined;

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
                <TaskRow key={v.id} view={v} now={now} assign={assign} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
