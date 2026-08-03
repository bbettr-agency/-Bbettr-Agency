import type { Metadata } from "next";
import { Suspense } from "react";
import { Inbox } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { QuickCapture } from "@/components/planner/tasks/quick-capture";
import { InboxList } from "@/components/planner/tasks/inbox-list";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  // Enforces admin + Planner access; `tasksEnabled` is read at request time.
  const { tasksEnabled } = await requireTasksView();

  // Flag OFF ⇒ the existing placeholder; no partial Tasks UI ever renders.
  if (!tasksEnabled) {
    return (
      <PlannerPlaceholder
        title="Inbox"
        description="Unscheduled tasks waiting to be planned."
        icon={Inbox}
        note="The task Inbox is coming to the Planner. The tasks data model already treats a null scheduled date as Inbox; this view will be delivered as the next Planner feature."
      />
    );
  }

  // Flag ON ⇒ the real Inbox shell: capture + the display-only triage queue.
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Inbox"
        description="Untriaged agency work that still needs a decision. Capture it here, triage it next."
      />
      <QuickCapture />
      <Suspense fallback={<SkeletonList rows={4} height="h-12" />}>
        <InboxList />
      </Suspense>
    </div>
  );
}
