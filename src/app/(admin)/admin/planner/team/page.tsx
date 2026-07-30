import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";

export const metadata: Metadata = { title: "Team View" };

export default async function TeamViewPage() {
  await requirePlannerAccess();
  return (
    <PlannerPlaceholder
      title="Team View"
      description="Tasks across the whole team, grouped by assignee."
      icon={UsersRound}
      note="Team task management is coming to the Planner. The tasks data model is in place; this view will be delivered as the next Planner feature."
    />
  );
}
