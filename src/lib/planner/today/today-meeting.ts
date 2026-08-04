/**
 * The minimal, presentation-safe meeting shape the pure Today logic needs. Mapped
 * from a Meeting row upstream; the pure modules never see the raw row. Meetings
 * carry no client/assignee columns, so Today never shows (nor fabricates) them.
 */
import type { MeetingStatus } from "@/lib/database.types";

export interface TodayMeeting {
  id: string;
  title: string;
  startsAt: string; // ISO instant
  endsAt: string; // ISO instant
  status: MeetingStatus;
  hasMeet: boolean;
}

/** Minutes from `now` until the meeting starts (negative once started). */
export function minutesUntil(startsAt: string, now: Date): number {
  return Math.round((new Date(startsAt).getTime() - now.getTime()) / 60000);
}

/** Meetings that have not yet ended and are not cancelled, chronological. */
export function remainingMeetings(meetings: TodayMeeting[], now: Date): TodayMeeting[] {
  return meetings
    .filter((m) => m.status !== "cancelled" && new Date(m.endsAt).getTime() > now.getTime())
    .slice()
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** The next meeting still to start today (soonest future start), or null. */
export function nextMeeting(meetings: TodayMeeting[], now: Date): TodayMeeting | null {
  const upcoming = meetings
    .filter((m) => m.status !== "cancelled" && new Date(m.startsAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return upcoming[0] ?? null;
}
