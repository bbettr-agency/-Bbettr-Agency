import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCircle2 } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { WeeklyDashboard } from "@/components/planner/weekly/weekly-dashboard";

export const metadata: Metadata = { title: "Weekly Updates" };

export default async function WeeklyUpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // Enforces admin + Planner access (404s when the module is off). `tasksEnabled`
  // is read at request time, so TASKS_ENABLED gating is preserved unchanged.
  const { tasksEnabled } = await requireTasksView();

  if (!tasksEnabled) {
    return (
      <PlannerPlaceholder
        title="Weekly Updates"
        description="What the team actually got done this week."
        icon={CheckCircle2}
        note="Weekly Updates rolls up completed Planner tasks and off-Planner work into one weekly view. It arrives with the Planner task module."
      />
    );
  }

  const { week } = await searchParams;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Weekly Updates"
        description="What we actually got done this week — completed tasks appear automatically; add anything off-Planner."
      />
      <Suspense fallback={<SkeletonList rows={4} height="h-24" />}>
        <WeeklyDashboard weekParam={week} />
      </Suspense>
    </div>
  );
}
