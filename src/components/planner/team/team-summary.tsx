import { Users, ListChecks, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { KpiCard } from "@/components/planner/overview/kpi-card";
import type { TeamSummary } from "@/lib/planner/team/team-board";

/**
 * Team Summary — five real workspace totals (no fabricated metrics). Reuses the
 * existing Overview KpiCard so the visual language matches exactly. Overdue and
 * "completed today" surface an honest tone when there is something to notice.
 */
export function TeamSummaryTiles({ summary }: { summary: TeamSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard label="Team members" value={summary.members} icon={Users} />
      <KpiCard label="Active tasks" value={summary.activeTasks} icon={ListChecks} />
      <KpiCard
        label="Overdue tasks"
        value={summary.overdueTasks}
        icon={AlertTriangle}
        tone={summary.overdueTasks > 0 ? "danger" : "default"}
        secondary={summary.overdueTasks > 0 ? "Needs attention" : "All on track"}
      />
      <KpiCard
        label="Completed today"
        value={summary.completedToday}
        icon={CheckCircle2}
        tone={summary.completedToday > 0 ? "success" : "default"}
      />
      <KpiCard label="Meetings today" value={summary.meetingsToday} icon={CalendarClock} />
    </div>
  );
}
