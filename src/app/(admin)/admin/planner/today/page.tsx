import type { Metadata } from "next";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { meetingsOnDate, todayDate } from "@/lib/planner/meetings/date-views";
import { PageHeader } from "@/components/ui/page-header";
import { MeetingList } from "@/components/planner/meeting-list";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  await requirePlannerAccess();

  const now = new Date();
  const meetings = await listMeetings();
  const today = meetingsOnDate(meetings, todayDate(now));
  const views = await getSafeProjectionViews(today.map((m) => m.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Today" description="Meetings scheduled for today." />
      <MeetingList
        meetings={today}
        views={views}
        emptyLabel="Nothing scheduled for today."
      />
    </div>
  );
}
