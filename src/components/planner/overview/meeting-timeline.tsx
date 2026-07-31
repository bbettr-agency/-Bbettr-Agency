import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SyncStatusBadge } from "@/components/planner/sync-status-badge";
import { MeetLink } from "@/components/planner/meet-link";
import { formatDayLabel, formatTimeInZone } from "@/lib/planner/meetings/date-views";
import { durationMinutes, type TimelineDay } from "@/lib/planner/meetings/meeting-metrics";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Central Overview section: scheduled (and muted cancelled) meetings from today
 * to the end of the agency week, grouped by day. Renders only safe Portal state
 * (Meeting + SafeProjectionView) — no client sync logic, no Google calls.
 */
export function MeetingTimeline({
  days,
  views,
  ownerName,
  nextId,
  nowMs,
  tz,
}: {
  days: TimelineDay[];
  views: Map<string, SafeProjectionView>;
  ownerName: (id: string) => string;
  nextId: string | null;
  nowMs: number;
  tz: string;
}) {
  if (days.length === 0) {
    return <p className="text-sm text-ink-500">No meetings scheduled for the rest of the week.</p>;
  }
  const now = new Date(nowMs);

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <div key={day.date}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {formatDayLabel(day.date, now, tz)}
          </p>
          <div className="space-y-2">
            {day.meetings.map((m) => {
              const view = views.get(m.id);
              const cancelled = m.status === "cancelled";
              const past = !cancelled && new Date(m.ends_at).getTime() <= nowMs;
              const isNext = m.id === nextId;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                    isNext ? "border-brand-200 bg-brand-50/40" : "border-ink-100",
                    (cancelled || past) && "opacity-60"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="w-16 shrink-0">
                      <p className={cn("text-sm font-semibold", isNext ? "text-brand-700" : "text-ink-900")}>
                        {formatTimeInZone(m.starts_at, tz)}
                      </p>
                      <p className="text-xs text-ink-400">{fmtDuration(durationMinutes(m))}</p>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/planner/meetings/${m.id}`}
                          className={cn(
                            "truncate text-sm font-medium hover:text-brand-700",
                            cancelled ? "text-ink-500 line-through" : "text-ink-900"
                          )}
                        >
                          {m.title}
                        </Link>
                        {cancelled && <Badge tone="neutral">Cancelled</Badge>}
                        {isNext && <Badge tone="brand">Next</Badge>}
                      </div>
                      <p className="text-xs text-ink-500">{ownerName(m.created_by)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {!cancelled && <SyncStatusBadge view={view} />}
                        <MeetLink url={view?.meetUrl ?? null} />
                      </div>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/planner/meetings/${m.id}`}>
                      Open <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
