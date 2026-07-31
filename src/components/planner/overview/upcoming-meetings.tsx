import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MeetingRow } from "./meeting-row";
import { formatDayLabel } from "@/lib/planner/meetings/date-views";
import type { TimelineDay } from "@/lib/planner/meetings/meeting-metrics";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

/**
 * Upcoming meetings for the rest of the week (tomorrow → Sunday), grouped by day
 * and capped by the caller. Today is never repeated here. Always offers a link
 * through to the full calendar.
 */
export function UpcomingMeetings({
  days,
  views,
  ownerName,
  tz,
  now,
}: {
  days: TimelineDay[];
  views: Map<string, SafeProjectionView>;
  ownerName: (id: string) => string;
  tz: string;
  now: Date;
}) {
  return (
    <div className="space-y-5">
      {days.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing else scheduled this week.</p>
      ) : (
        days.map((day) => (
          <div key={day.date}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
              {formatDayLabel(day.date, now, tz)}
            </p>
            <div className="space-y-2">
              {day.meetings.map((m) => (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  view={views.get(m.id)}
                  ownerName={ownerName(m.created_by)}
                  tz={tz}
                />
              ))}
            </div>
          </div>
        ))
      )}
      <div className="pt-1">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/planner/meetings">
            View full calendar <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
