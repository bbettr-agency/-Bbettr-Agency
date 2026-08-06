import type { Metadata } from "next";
import { Suspense } from "react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { meetingsInRange, weekRange } from "@/lib/planner/meetings/date-views";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { MeetingList } from "@/components/planner/meeting-list";
import { WeekDashboard } from "@/components/planner/week/week-dashboard";

export const metadata: Metadata = { title: "This Week" };

export default async function WeekPage() {
  // Enforces admin + Planner access (404s when the module is off). `tasksEnabled`
  // is read at request time, preserving TASKS_ENABLED gating.
  const { tasksEnabled } = await requireTasksView();

  // Flag ON ⇒ the personal weekly plan (my tasks, day-bucketed + overdue).
  if (tasksEnabled) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="This Week"
          description="Your week at a glance — plan and reschedule your tasks across the days ahead."
        />
        <Suspense fallback={<SkeletonList rows={6} height="h-16" />}>
          <WeekDashboard />
        </Suspense>
      </div>
    );
  }

  // Flag OFF ⇒ the existing meetings-only week (unchanged live behaviour).
  const now = new Date();
  const meetings = await listMeetings();
  const { start, end } = weekRange(now);
  const thisWeek = meetingsInRange(meetings, start, end);
  const views = await getSafeProjectionViews(thisWeek.map((m) => m.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="This Week" description="Meetings from Monday to Sunday of the current week." />
      <MeetingList meetings={thisWeek} views={views} emptyLabel="Nothing scheduled this week." />
    </div>
  );
}
