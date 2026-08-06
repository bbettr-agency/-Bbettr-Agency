import { AlertCircle, CalendarRange } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getWeekTasks } from "@/lib/planner/tasks/read-adapters";
import { listAdminTeam } from "@/lib/planner/team";
import { toTaskView } from "@/lib/planner/tasks/task-view";
import { groupWeek } from "@/lib/planner/week/week-grouping";
import { TaskRow } from "@/components/planner/tasks/task-row";
import { WeekDaySection } from "./week-day-section";

/**
 * This Week (flag-on) — the admin's PERSONAL weekly plan. Server Component: the
 * task read is authoritative; team names are best-effort enrichment in ONE batched
 * lookup (no N+1) and a failure never blanks the page. Deterministic day-bucketing
 * runs in the pure week layer; only the per-row Task Kit controls hydrate, so you
 * can plan by rescheduling/completing in place. Read is the current admin's own
 * (owner|assignee) work only — distinct from Team View (everyone, read-only).
 */
export async function WeekDashboard() {
  const [weekRes, teamRes] = await Promise.allSettled([getWeekTasks(), listAdminTeam()]);

  if (weekRes.status === "rejected") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <AlertCircle className="h-4 w-4 text-ink-400" />
          <span>Couldn&rsquo;t load your week right now. Refresh to try again.</span>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const { today, weekStart, tasks } = weekRes.value;

  const nameById = new Map<string, string>();
  if (teamRes.status === "fulfilled") for (const m of teamRes.value) nameById.set(m.id, m.fullName);

  const views = tasks.map((t) => toTaskView(t, nameById, today));
  const { overdue, days } = groupWeek(views, weekStart);

  if (views.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing planned this week"
        description="Schedule tasks from My Tasks or the Inbox onto a day, and they'll appear here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {overdue.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" /> Overdue
            </CardTitle>
            <span className="text-xs font-medium text-red-600">{overdue.length}</span>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-ink-100">
              {overdue.map((v) => (
                <TaskRow key={v.id} view={v} now={now} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {days.map((d) => (
          <WeekDaySection key={d.date} day={d} now={now} today={today} />
        ))}
      </div>
    </div>
  );
}
