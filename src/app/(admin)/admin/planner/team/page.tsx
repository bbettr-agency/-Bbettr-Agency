import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersRound } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { getTeamViewData } from "@/lib/planner/team/team-read";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { TeamSummaryTiles } from "@/components/planner/team/team-summary";
import { TeamBoard } from "@/components/planner/team/team-board";

export const metadata: Metadata = { title: "Team View" };

export default async function TeamViewPage() {
  // Enforces admin + Planner access (404s when the module is off). `tasksEnabled`
  // is read at request time, so TASKS_ENABLED gating is preserved unchanged.
  const { tasksEnabled } = await requireTasksView();

  if (!tasksEnabled) {
    return (
      <PlannerPlaceholder
        title="Team View"
        description="Tasks across the whole team, grouped by assignee."
        icon={UsersRound}
        note="Team task management is coming to the Planner. The tasks data model is in place; this view will be delivered as the next Planner feature."
      />
    );
  }

  return (
    <Suspense fallback={<SkeletonList rows={6} height="h-24" />}>
      <TeamViewContent />
    </Suspense>
  );
}

/** Server content: one workspace-scoped read → real Summary + the filter island. */
async function TeamViewContent() {
  const data = await getTeamViewData();
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Team View"
        description="Cross-team operational visibility — who is busy, who has capacity, and where client work is at risk."
      />
      <TeamSummaryTiles summary={data.summary} />
      <TeamBoard facets={data.facets} reminders={data.reminders} completed={data.completed} members={data.members} />
    </div>
  );
}
