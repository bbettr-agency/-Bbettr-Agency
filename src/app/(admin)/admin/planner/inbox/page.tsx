import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requirePlannerAccess();
  return (
    <PlannerPlaceholder
      title="Inbox"
      description="Unscheduled tasks waiting to be planned."
      icon={Inbox}
      note="The task Inbox is coming to the Planner. The tasks data model already treats a null scheduled date as Inbox; this view will be delivered as the next Planner feature."
    />
  );
}
