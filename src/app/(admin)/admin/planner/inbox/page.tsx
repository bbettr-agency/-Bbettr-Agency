import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { QuickCapture } from "@/components/planner/tasks/quick-capture";

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

  // Flag ON ⇒ the real Inbox shell. Quick Capture is live; the queue list is the
  // next slice (C2.1c), so the region below is an honest, temporary note that is
  // replaced by the real list in C2.1c.
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Inbox"
        description="Untriaged agency work that still needs a decision. Capture it here, triage it next."
      />
      <QuickCapture />
      <p className="text-sm text-ink-500">
        Captured tasks are saved to the shared agency Inbox. The triage queue list
        appears here next.
      </p>
    </div>
  );
}
