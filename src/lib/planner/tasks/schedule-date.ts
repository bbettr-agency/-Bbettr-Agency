/**
 * Pure schedule-date policy for Inbox scheduling (no I/O; `now` injectable).
 *
 * Locked rules (C2.1d): the schedule date is a real `YYYY-MM-DD` calendar day
 * that is TODAY OR IN THE FUTURE in the agency timezone (Africa/Johannesburg).
 * Backdating `scheduled_date` is meaningless — overdue is a `due_date` concept.
 * This module is the single source of truth for that policy and is used at BOTH
 * boundaries: the client control (default value + native `min`) and the server
 * action (which re-validates so a crafted request cannot bypass the rule).
 * It never touches `due_date` and invents no task time.
 */
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed `YYYY-MM-DD` that is a real calendar day (rejects 2026-13-01, 2026-02-30, "2026-8-1"). */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today in the agency timezone as `YYYY-MM-DD`. `now` is injectable for determinism. */
export function agencyToday(now: Date = new Date()): string {
  return todayDate(now, AGENCY_TZ);
}

/**
 * True when `date` is today or later than `today`. Both are zero-padded
 * `YYYY-MM-DD`, so a lexicographic compare is exactly a chronological compare.
 */
export function isTodayOrFuture(date: string, today: string): boolean {
  return date >= today;
}

/** The full Inbox schedule-date rule: a real calendar day that is today-or-future. */
export function isValidScheduleDate(value: unknown, today: string): value is string {
  return isValidCalendarDate(value) && isTodayOrFuture(value, today);
}
