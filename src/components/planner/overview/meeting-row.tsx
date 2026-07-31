import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SyncStatusBadge } from "@/components/planner/sync-status-badge";
import { MeetLink } from "@/components/planner/meet-link";
import { formatTimeInZone } from "@/lib/planner/meetings/date-views";
import { durationMinutes } from "@/lib/planner/meetings/meeting-metrics";
import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * One meeting line, shared by Today's Meetings and Upcoming This Week. Renders
 * only safe Portal state (Meeting + SafeProjectionView) — no Google calls, no
 * client-side sync logic. Meetings carry no client linkage in the schema, so no
 * "client" is shown (never fabricated).
 *
 * - `highlight` gives the row the brand-tinted "this is the one" treatment.
 * - `muted` dims completed/cancelled rows.
 * - `badge` is an optional lead badge (e.g. "Next", "Starting soon", "Now").
 * - `timeLabel` overrides the start time (e.g. a "09:00–10:00" range).
 * - `subLabel` overrides the duration line (e.g. "In progress", "in 24 min").
 */
export function MeetingRow({
  meeting,
  view,
  ownerName,
  tz,
  highlight = false,
  muted = false,
  badge,
  timeLabel,
  subLabel,
}: {
  meeting: Meeting;
  view?: SafeProjectionView;
  ownerName: string;
  tz: string;
  highlight?: boolean;
  muted?: boolean;
  badge?: { label: string; tone: "brand" | "warning" | "success" | "neutral" };
  timeLabel?: string;
  subLabel?: string;
}) {
  const cancelled = meeting.status === "cancelled";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
        highlight ? "border-brand-200 bg-brand-50/40" : "border-ink-100",
        muted && "opacity-60"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn("shrink-0 whitespace-nowrap", timeLabel ? "w-24" : "w-16")}>
          <p className={cn("text-sm font-semibold", highlight ? "text-brand-700" : "text-ink-900")}>
            {timeLabel ?? formatTimeInZone(meeting.starts_at, tz)}
          </p>
          <p className={cn("text-xs", subLabel ? "font-medium text-ink-500" : "text-ink-400")}>
            {subLabel ?? fmtDuration(durationMinutes(meeting))}
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/planner/meetings/${meeting.id}`}
              className={cn(
                "truncate text-sm font-medium hover:text-brand-700",
                cancelled ? "text-ink-500 line-through" : "text-ink-900"
              )}
            >
              {meeting.title}
            </Link>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            {cancelled && <Badge tone="neutral">Cancelled</Badge>}
          </div>
          <p className="text-xs text-ink-500">{ownerName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {!cancelled && <SyncStatusBadge view={view} />}
            <MeetLink url={view?.meetUrl ?? null} />
          </div>
        </div>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href={`/admin/planner/meetings/${meeting.id}`}>
          Open <ArrowUpRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
