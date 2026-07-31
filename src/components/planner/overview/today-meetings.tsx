import { MeetingRow } from "./meeting-row";
import {
  startsWithinMinutes,
  minutesUntil,
  type TodayBuckets,
} from "@/lib/planner/meetings/meeting-metrics";
import { formatTimeInZone, formatCountdown } from "@/lib/planner/meetings/date-views";
import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{children}</p>
  );
}

const rangeLabel = (m: Meeting, tz: string) =>
  `${formatTimeInZone(m.starts_at, tz)}–${formatTimeInZone(m.ends_at, tz)}`;

/**
 * Today's meetings, split into live buckets and ordered so the dashboard orients
 * the user the instant it opens:
 *   NOW      — meetings in progress ("In progress").
 *   NEXT     — upcoming today; the next one is highlighted with a live countdown.
 *              When nothing is in progress, a one-line lead states when the next
 *              meeting starts instead of a NOW block.
 *   Completed / Cancelled — muted.
 * Calm empty state when there is nothing today at all.
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

  const next = upcoming[0];

  return (
    <div className="space-y-5">
      {current.length > 0 ? (
        <div>
          <GroupLabel>Now</GroupLabel>
          <div className="space-y-2">
            {current.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                view={views.get(m.id)}
                ownerName={ownerName(m.created_by)}
                tz={tz}
                highlight
                timeLabel={rangeLabel(m, tz)}
                subLabel="In progress"
                badge={{ label: "In progress", tone: "success" }}
              />
            ))}
          </div>
        </div>
      ) : (
        next && (
          <p className="text-sm font-medium text-ink-700">
            Next meeting starts in{" "}
            <span className="text-brand-700">{formatCountdown(minutesUntil(next, now))}</span>.
          </p>
        )
      )}

      {upcoming.length > 0 && (
        <div>
          <GroupLabel>{current.length > 0 ? "Next" : "Up next"}</GroupLabel>
          <div className="space-y-2">
            {upcoming.map((m, i) => {
              const isNext = i === 0;
              const soon = startsWithinMinutes(m, now, 30);
              const badge = soon
                ? ({ label: "Starting soon", tone: "warning" } as const)
                : isNext
                  ? ({ label: "Next", tone: "brand" } as const)
                  : undefined;
              return (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  view={views.get(m.id)}
                  ownerName={ownerName(m.created_by)}
                  tz={tz}
                  highlight={isNext}
                  subLabel={isNext ? `in ${formatCountdown(minutesUntil(m, now))}` : undefined}
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
