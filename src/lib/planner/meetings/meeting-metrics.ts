import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "./view-types";
import { AGENCY_TZ, localDate, todayDate, weekRange } from "./date-views";

/**
 * Pure, server-safe aggregations for the Planner Overview (CEO operations view).
 *
 * Every metric is derived only from real meeting rows + safe projection views —
 * no fabricated capacity/progress/trends. Cancelled meetings NEVER count toward
 * totals; past meetings are never "next". All day boundaries use the agency zone.
 * No I/O — fully unit-testable.
 */

/** Live, non-cancelled meetings (listMeetings already excludes soft-deleted). */
export function scheduledMeetings(meetings: Meeting[]): Meeting[] {
  return meetings.filter((m) => m.status === "scheduled");
}

/** Duration in whole minutes (never negative). */
export function durationMinutes(m: Pick<Meeting, "starts_at" | "ends_at">): number {
  const ms = new Date(m.ends_at).getTime() - new Date(m.starts_at).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/** Count of scheduled meetings on today's agency-local date. */
export function meetingsTodayCount(meetings: Meeting[], now: Date, tz: string = AGENCY_TZ): number {
  const d = todayDate(now, tz);
  return scheduledMeetings(meetings).filter((m) => localDate(m.starts_at, tz) === d).length;
}

/** Count of scheduled meetings in the current Monday–Sunday agency week. */
export function meetingsThisWeekCount(meetings: Meeting[], now: Date, tz: string = AGENCY_TZ): number {
  const { start, end } = weekRange(now, tz);
  return scheduledMeetings(meetings).filter((m) => {
    const d = localDate(m.starts_at, tz);
    return d >= start && d <= end;
  }).length;
}

/** The soonest scheduled meeting that has NOT yet started (never a past meeting). */
export function nextMeeting(meetings: Meeting[], now: Date): Meeting | null {
  const t = now.getTime();
  const upcoming = scheduledMeetings(meetings)
    .filter((m) => new Date(m.starts_at).getTime() >= t)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  return upcoming[0] ?? null;
}

export interface SyncHealth {
  failed: number;
  pending: number;
  synced: number;
  total: number;
  healthy: boolean;
}

/**
 * Roll up calendar projection health. `failed` includes `disconnected` (both fail
 * to sync); `healthy` means no failed and no pending projections.
 */
export function syncHealth(
  views: SafeProjectionView[] | Map<string, SafeProjectionView>
): SyncHealth {
  const arr = views instanceof Map ? [...views.values()] : views;
  let failed = 0;
  let pending = 0;
  let synced = 0;
  for (const v of arr) {
    if (v.syncState === "failed" || v.syncState === "disconnected") failed++;
    else if (v.syncState === "pending") pending++;
    else if (v.syncState === "synced") synced++;
  }
  return { failed, pending, synced, total: arr.length, healthy: failed === 0 && pending === 0 };
}

/** Number of overlapping scheduled-meeting PAIRS on a given agency-local date. */
export function overlapCountOnDay(
  meetings: Meeting[],
  date: string,
  tz: string = AGENCY_TZ
): number {
  const day = scheduledMeetings(meetings)
    .filter((m) => localDate(m.starts_at, tz) === date)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  let count = 0;
  for (let i = 0; i < day.length; i++) {
    const aS = new Date(day[i].starts_at).getTime();
    const aE = new Date(day[i].ends_at).getTime();
    for (let j = i + 1; j < day.length; j++) {
      const bS = new Date(day[j].starts_at).getTime();
      const bE = new Date(day[j].ends_at).getTime();
      if (aS < bE && bS < aE) count++;
    }
  }
  return count;
}

/** The day (with count) that has the most scheduled meetings this week; ties → earliest. */
export function busiestDay(
  meetings: Meeting[],
  now: Date,
  tz: string = AGENCY_TZ
): { date: string; count: number } | null {
  const { start, end } = weekRange(now, tz);
  const counts = new Map<string, number>();
  for (const m of scheduledMeetings(meetings)) {
    const d = localDate(m.starts_at, tz);
    if (d >= start && d <= end) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: { date: string; count: number } | null = null;
  for (const [date, count] of counts) {
    if (!best || count > best.count || (count === best.count && date < best.date)) {
      best = { date, count };
    }
  }
  return best;
}

/** Scheduled-meeting counts per owner (created_by), optionally within [from,to] dates. */
export function ownerMeetingCounts(
  meetings: Meeting[],
  opts: { from?: string; to?: string; tz?: string } = {}
): Map<string, number> {
  const tz = opts.tz ?? AGENCY_TZ;
  const map = new Map<string, number>();
  for (const m of scheduledMeetings(meetings)) {
    if (opts.from || opts.to) {
      const d = localDate(m.starts_at, tz);
      if (opts.from && d < opts.from) continue;
      if (opts.to && d > opts.to) continue;
    }
    map.set(m.created_by, (map.get(m.created_by) ?? 0) + 1);
  }
  return map;
}

/** Owner with the most scheduled meetings this week; ties → first seen. */
export function busiestOwner(
  meetings: Meeting[],
  now: Date,
  tz: string = AGENCY_TZ
): { ownerId: string; count: number } | null {
  const { start, end } = weekRange(now, tz);
  const counts = ownerMeetingCounts(meetings, { from: start, to: end, tz });
  let best: { ownerId: string; count: number } | null = null;
  for (const [ownerId, count] of counts) {
    if (!best || count > best.count) best = { ownerId, count };
  }
  return best;
}

export interface TimelineDay {
  date: string;
  meetings: Meeting[];
}

/**
 * Meetings grouped by agency-local day, from today through the end of the current
 * week, each day sorted chronologically. Includes cancelled meetings (the UI
 * mutes them, consistent with the Calendar) — callers exclude them from totals.
 */
export function timelineDays(
  meetings: Meeting[],
  now: Date,
  tz: string = AGENCY_TZ
): TimelineDay[] {
  const today = todayDate(now, tz);
  const { end } = weekRange(now, tz);
  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const d = localDate(m.starts_at, tz);
    if (d < today || d > end) continue;
    const list = byDay.get(d) ?? [];
    list.push(m);
    byDay.set(d, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, ms]) => ({
      date,
      meetings: ms.sort(
        (x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
      ),
    }));
}
