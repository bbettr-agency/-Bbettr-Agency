import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { getRecurringDefinitions } from "@/lib/planner/recurrence/recurrence-read";
import { PlannerPlaceholder } from "@/components/planner/planner-placeholder";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StopRepeatingButton } from "@/components/planner/recurrences/stop-repeating-button";

export const metadata: Metadata = { title: "Recurring Reminders" };

/** Agency-local day label for a plain YYYY-MM-DD (UTC-noon anchor; no drift). */
function fmt(ymd: string | null): string {
  if (!ymd) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T12:00:00Z`));
}

export default async function RecurrencesPage() {
  const { tasksEnabled } = await requireTasksView();
  if (!tasksEnabled) {
    return (
      <PlannerPlaceholder
        title="Recurring Reminders"
        description="Operational reminders that repeat on a schedule."
        icon={CalendarClock}
        note="Recurring reminders (e.g. monthly client invoices) generate real Planner tasks automatically. This arrives with the Planner task module."
      />
    );
  }
  return (
    <Suspense fallback={<SkeletonList rows={4} height="h-20" />}>
      <RecurrencesContent />
    </Suspense>
  );
}

async function RecurrencesContent() {
  const { definitions } = await getRecurringDefinitions();
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Recurring Reminders"
        description="Reminders that repeat on a schedule — e.g. monthly client invoices. Create one from the Inbox: choose Daily, Weekly or Monthly when you schedule a task."
      />
      {definitions.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No recurring reminders yet"
          description="Capture a task in the Inbox, then choose Daily, Weekly or Monthly when you schedule it to make it repeat."
        />
      ) : (
        <div className="space-y-3">
          {definitions.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink-900">{d.title}</p>
                    <Badge tone="neutral">{d.cadence}</Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                    <span className="truncate">{d.clientName}</span>
                    <span className="text-ink-300">·</span>
                    <span>{d.ownerName}</span>
                    <span className="text-ink-300">·</span>
                    <span>Next: {fmt(d.nextOccurrence)}</span>
                    {d.completedCount > 0 ? (
                      <>
                        <span className="text-ink-300">·</span>
                        <span>{d.completedCount} done</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <StopRepeatingButton id={d.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
