import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AGENCY_TZ, formatTimeInZone } from "@/lib/planner/meetings/date-views";
import type { TodayTimeline as TodayTimelineData } from "@/lib/planner/today/timeline";

/** Timeline (v1) — timed meetings chronologically; tasks as an unslotted queue.
 *  No invented task times or planning slots. */
export function TodayTimeline({ timeline }: { timeline: TodayTimelineData }) {
  if (timeline.meetings.length === 0 && timeline.taskQueue.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {timeline.meetings.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Meetings</p>
            <ul className="mt-1.5 space-y-1">
              {timeline.meetings.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-ink-700">
                  <span className="tabular-nums text-ink-500">{formatTimeInZone(m.startsAt, AGENCY_TZ)}</span>
                  <span className="truncate">{m.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {timeline.taskQueue.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Task queue (unslotted)</p>
            <ul className="mt-1.5 space-y-1">
              {timeline.taskQueue.map((t) => (
                <li key={t.id} className="truncate text-sm text-ink-700">
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
