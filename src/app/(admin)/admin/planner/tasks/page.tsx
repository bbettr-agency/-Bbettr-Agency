import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { MyTasksList } from "@/components/planner/tasks/my-tasks-list";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage() {
  // Enforces admin + Planner access; `tasksEnabled` is read at request time.
  const { tasksEnabled } = await requireTasksView();

  // Flag OFF ⇒ the existing placeholder; no My Tasks read, kit or actions run.
  if (!tasksEnabled) {
    return (
      <PlannerPlaceholder
        title="My Tasks"
        description="Tasks assigned to you."
        icon={ListChecks}
        note="Task management is coming to the Planner. The tasks data model is in place; the task views (My Tasks, Team View, Inbox) will be delivered as the next Planner feature."
      />
    );
  }

  // Flag ON ⇒ the real personal task workspace (first consumer of the shared Task Kit).
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Tasks"
        description="Your active agency work — start, schedule, block and complete what&rsquo;s on your plate."
      />
      <Suspense fallback={<SkeletonList rows={5} height="h-12" />}>
        <MyTasksList />
      </Suspense>
    </div>
  );
}
