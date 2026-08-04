import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingList } from "@/components/planner/meeting-list";
import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";
import { MeetingCountdown } from "./meeting-countdown";

/** Today's meetings — chronological, real fields only (reuses the meetings kit).
 *  When the next meeting is imminent, a live countdown banner is shown. */
export function TodayMeetings({
  meetings,
  views,
  soon,
}: {
  meetings: Meeting[];
  views: Map<string, SafeProjectionView>;
  soon: { title: string; startsAt: string; minutes: number } | null;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Today&rsquo;s meetings</CardTitle>
        <span className="text-xs text-ink-500">{meetings.length}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {soon ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span className="truncate font-medium">{soon.title}</span>
            <span className="shrink-0">
              starts <MeetingCountdown startsAt={soon.startsAt} initialMinutes={soon.minutes} />
            </span>
          </div>
        ) : null}
        <MeetingList meetings={meetings} views={views} emptyLabel="No meetings today." />
      </CardContent>
    </Card>
  );
}
