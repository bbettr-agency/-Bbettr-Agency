import { MeetingRow } from "./meeting-row";
import {
  startsWithinMinutes,
  type TodayBuckets,
} from "@/lib/planner/meetings/meeting-metrics";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{children}</p>
  );
}

/**
 * Today's meetings, split into live buckets. Order (most actionable first):
 * Happening now → Upcoming (first is "Next", "Starting soon" within 30m) →
 * Completed (muted) → Cancelled (muted). Calm empty state when nothing today.
 */
export function TodayMeetings({
  buckets,
  views,
  ownerName,
  tz,
  now,
}: {
  buckets: TodayBuckets;
  views: Map<string, SafeProjectionView>;
  ownerName: (id: string) => string;
  tz: string;
  now: Date;
}) {
  const { current, upcoming, completed, cancelled } = buckets;
  const isEmpty =
    current.length === 0 &&
    upcoming.length === 0 &&
    completed.length === 0 &&
    cancelled.length === 0;

  if (isEmpty) {
    return <p className="text-sm text-ink-500">No meetings scheduled today.</p>;
  }

  return (
    <div className="space-y-5">
      {current.length > 0 && (
        <div>
          <GroupLabel>Happening now</GroupLabel>
          <div className="space-y-2">
            {current.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                view={views.get(m.id)}
                ownerName={ownerName(m.created_by)}
                tz={tz}
                highlight
                badge={{ label: "Now", tone: "success" }}
              />
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <GroupLabel>Upcoming today</GroupLabel>
          <div className="space-y-2">
            {upcoming.map((m, i) => {
              const soon = startsWithinMinutes(m, now, 30);
              const badge = soon
                ? ({ label: "Starting soon", tone: "warning" } as const)
                : i === 0
                  ? ({ label: "Next", tone: "brand" } as const)
                  : undefined;
              return (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  view={views.get(m.id)}
                  ownerName={ownerName(m.created_by)}
                  tz={tz}
                  highlight={i === 0}
                  badge={badge}
                />
              );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <GroupLabel>Completed</GroupLabel>
          <div className="space-y-2">
            {completed.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                view={views.get(m.id)}
                ownerName={ownerName(m.created_by)}
                tz={tz}
                muted
              />
            ))}
          </div>
        </div>
      )}

      {cancelled.length > 0 && (
        <div>
          <GroupLabel>Cancelled</GroupLabel>
          <div className="space-y-2">
            {cancelled.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                view={views.get(m.id)}
                ownerName={ownerName(m.created_by)}
                tz={tz}
                muted
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
