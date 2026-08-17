import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SyncStatusBadge, MeetStatusBadge } from "./sync-status-badge";
import { MeetLink } from "./meet-link";
import { MeetingRowActions } from "./meeting-row-actions";
import { formatMeetingRange } from "@/lib/planner/meetings/date-views";
import { deriveMeetingState, LIFECYCLE_META } from "@/lib/planner/meetings/lifecycle";
import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

/**
 * Reusable meeting list (Calendar / Today / This Week / Overview). Renders purely
 * from Meeting + SafeProjectionView — no client sync logic, no Google calls. The
 * lifecycle badge + state-aware actions are derived from the meeting's stored
 * annotations. `now` is passed by the caller so grouping and rendering agree.
 */
export function MeetingList({
  meetings,
  views,
  showActions = true,
  emptyLabel = "No meetings.",
  now,
}: {
  meetings: Meeting[];
  views: Map<string, SafeProjectionView>;
  showActions?: boolean;
  emptyLabel?: string;
  now?: Date;
}) {
  if (meetings.length === 0) {
    return <p className="text-sm text-ink-500">{emptyLabel}</p>;
  }
  const clock = now ?? new Date();
  return (
    <div className="space-y-3">
      {meetings.map((m) => {
        const view = views.get(m.id);
        const state = deriveMeetingState(m, clock);
        return (
          <Card key={m.id}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/planner/meetings/${m.id}`}
                    className="truncate font-semibold text-ink-900 hover:text-brand-700"
                  >
                    {m.title}
                  </Link>
                  {/* Show a state badge for every state except plain "upcoming". */}
                  {state !== "upcoming" && (
                    <Badge tone={LIFECYCLE_META[state].tone}>{LIFECYCLE_META[state].label}</Badge>
                  )}
                </div>
                <p className="text-sm text-ink-500">
                  {formatMeetingRange(m.starts_at, m.ends_at, m.time_zone)}{" "}
                  <span className="text-ink-400">· {m.time_zone}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <SyncStatusBadge view={view} />
                  <MeetStatusBadge view={view} />
                  <MeetLink url={view?.meetUrl ?? null} />
                </div>
              </div>
              {showActions && (
                <MeetingRowActions
                  id={m.id}
                  state={state}
                  noShowAt={m.no_show_at}
                  followupSentAt={m.no_show_followup_sent_at}
                  thankYouSentAt={m.thank_you_sent_at}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
