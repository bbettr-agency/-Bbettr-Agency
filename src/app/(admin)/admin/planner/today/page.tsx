import type { Metadata } from "next";
import { Suspense } from "react";
import { requireTasksView } from "@/lib/planner/tasks/view-access";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { meetingsOnDate, todayDate } from "@/lib/planner/meetings/date-views";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { MeetingList } from "@/components/planner/meeting-list";
import { TodayDashboard } from "@/components/planner/today/today-dashboard";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  // Enforces admin + Planner access; `tasksEnabled` is read at request time.
  const { tasksEnabled } = await requireTasksView();

  // Flag ON ⇒ the full agency command centre (tasks + meetings + NBA/progress/…).
  if (tasksEnabled) {
    return (
      <Suspense fallback={<SkeletonList rows={6} height="h-16" />}>
        <TodayDashboard />
      </Suspense>
    );
  }

  // Flag OFF ⇒ the existing meetings-only Today (unchanged live behaviour).
  const now = new Date();
  const meetings = await listMeetings();
  const today = meetingsOnDate(meetings, todayDate(now));
  const views = await getSafeProjectionViews(today.map((m) => m.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Today" description="Meetings scheduled for today." />
      <MeetingList meetings={today} views={views} emptyLabel="Nothing scheduled for today." />
    </div>
  );
}
