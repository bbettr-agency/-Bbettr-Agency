import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage() {
  await requirePlannerAccess();
  return (
    <PlannerPlaceholder
      title="My Tasks"
      description="Tasks assigned to you."
      icon={ListChecks}
      note="Task management is coming to the Planner. The tasks data model is in place; the task views (My Tasks, Team View, Inbox) will be delivered as the next Planner feature."
    />
  );
}
