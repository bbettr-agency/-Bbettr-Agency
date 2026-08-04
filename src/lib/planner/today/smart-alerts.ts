/**
 * Pure Smart Alerts (no I/O). Emits ONLY genuine, actionable alerts derived from
 * real data; returns [] when nothing is important (the section is then hidden).
 * No fabrication: "newly assigned" is intentionally NOT emitted because no
 * authoritative "new assignment" signal exists yet.
 */
import { formatCountdown } from "@/lib/planner/meetings/date-views";
import { minutesUntil, nextMeeting, type TodayMeeting } from "./today-meeting";

export interface TodayAlert {
  key: string;
  tone: "info" | "warning" | "danger";
  message: string;
}

/** Emit the "meeting starting soon" alert within this many minutes. */
const MEETING_SOON = 15;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export interface SmartAlertInput {
  now: Date;
  meetings: TodayMeeting[];
  overdueCount: number;
  dueTodayCount: number; // due today AND not overdue
  estimatedRemainingMinutes: number; // remaining actionable estimate total
}

export function smartAlerts(input: SmartAlertInput): TodayAlert[] {
  const alerts: TodayAlert[] = [];
  const next = nextMeeting(input.meetings, input.now);
  const mins = next ? minutesUntil(next.startsAt, input.now) : null;

  if (next && mins != null && mins >= 0 && mins <= MEETING_SOON) {
    alerts.push({ key: "meeting-soon", tone: "warning", message: `“${next.title}” starts in ${formatCountdown(mins)}.` });
  }
  if (input.overdueCount > 0) {
    alerts.push({ key: "overdue", tone: "danger", message: `${plural(input.overdueCount, "task")} overdue.` });
  }
  if (input.dueTodayCount > 0) {
    alerts.push({ key: "due-today", tone: "info", message: `${plural(input.dueTodayCount, "task")} due today.` });
  }
  if (next && mins != null && mins > 0 && input.estimatedRemainingMinutes > mins) {
    alerts.push({ key: "wont-fit", tone: "warning", message: `Your remaining estimated work (${formatCountdown(input.estimatedRemainingMinutes)}) won't fit before your next meeting.` });
  }
  return alerts;
}
