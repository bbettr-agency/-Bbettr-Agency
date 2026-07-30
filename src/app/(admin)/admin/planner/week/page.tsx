import type { Metadata } from "next";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { meetingsInRange, weekRange } from "@/lib/planner/meetings/date-views";
import { PageHeader } from "@/components/ui/page-header";
import { MeetingList } from "@/components/planner/meeting-list";

export const metadata: Metadata = { title: "This Week" };

export default async function WeekPage() {
  await requirePlannerAccess();

  const now = new Date();
  const meetings = await listMeetings();
  const { start, end } = weekRange(now);
  const thisWeek = meetingsInRange(meetings, start, end);
  const views = await getSafeProjectionViews(thisWeek.map((m) => m.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="This Week"
        description="Meetings from Monday to Sunday of the current week."
      />
      <MeetingList
        meetings={thisWeek}
        views={views}
        emptyLabel="Nothing scheduled this week."
      />
    </div>
  );
}
