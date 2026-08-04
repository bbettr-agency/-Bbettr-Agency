import { AlertCircle, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getInboxTasks } from "@/lib/planner/tasks/read-adapters";
import { listAdminTeam } from "@/lib/planner/team";
import { InboxRow } from "./inbox-row";
import { toInboxRowView } from "./inbox-row-view";

/**
 * The shared agency Inbox list — display only, server-rendered.
 *
 * RESILIENCE (locked): the task read is authoritative; captured-by names are
 * OPTIONAL enrichment. Both run in parallel, but a team-name failure must NEVER
 * blank the list — only a task-read failure shows the inline error. No raw
 * database details are exposed; no client JS, no mutation path.
 */
export async function InboxList() {
  const [tasksResult, teamResult] = await Promise.allSettled([getInboxTasks(), listAdminTeam()]);

  // Authoritative failure only: tasks could not be read.
  if (tasksResult.status === "rejected") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <AlertCircle className="h-4 w-4 text-ink-400" />
          <span>Couldn&rsquo;t load the Inbox right now. Refresh to try again.</span>
        </CardContent>
      </Card>
    );
  }

  const tasks = tasksResult.value;

  // Best-effort name resolution; a failure just means no attribution.
  const nameById = new Map<string, string>();
  if (teamResult.status === "fulfilled") {
    for (const m of teamResult.value) nameById.set(m.id, m.fullName);
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="You&rsquo;re at inbox zero"
        description="Nothing to triage right now."
      />
    );
  }

  // One fixed baseline for every row's relative label in this render.
  const now = new Date();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Inbox</CardTitle>
        <span className="text-xs text-ink-500">
          {tasks.length} to triage
        </span>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-ink-100">
          {tasks.map((t) => (
            <InboxRow
              key={t.id}
              view={toInboxRowView(t, nameById.get(t.created_by) ?? null, now)}
              target={{ taskId: t.id, aggregateVersion: t.aggregate_version, title: t.title }}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
