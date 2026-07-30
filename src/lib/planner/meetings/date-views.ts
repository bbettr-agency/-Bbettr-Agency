import type { Meeting } from "@/lib/database.types";

/**
 * Pure date helpers for the Planner meeting views (Today / This Week / Overview).
 * All "day" boundaries are computed in the agency time zone so a meeting's day is
 * stable regardless of the viewer's locale. No I/O — easy to reason about/test.
 */

export const AGENCY_TZ = "Africa/Johannesburg";

/** The calendar date (YYYY-MM-DD) of an instant, in `tz`. */
export function localDate(iso: string, tz: string = AGENCY_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayDate(now: Date, tz: string = AGENCY_TZ): string {
  return localDate(now.toISOString(), tz);
}

/** The Monday–Sunday range (YYYY-MM-DD strings) of the week containing `now`. */
export function weekRange(now: Date, tz: string = AGENCY_TZ): { start: string; end: string } {
  const [y, m, d] = todayDate(now, tz).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d)); // plain-date math in UTC
  const dow = base.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = (dow + 6) % 7;
  const mon = new Date(base);
  mon.setUTCDate(base.getUTCDate() - mondayOffset);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}

/** Meetings occurring on a given agency-local date, soonest first. */
export function meetingsOnDate(
  meetings: Meeting[],
  date: string,
  tz: string = AGENCY_TZ
): Meeting[] {
  return meetings.filter((m) => localDate(m.starts_at, tz) === date);
}

/** Meetings whose agency-local date falls within [start, end] (inclusive). */
export function meetingsInRange(
  meetings: Meeting[],
  start: string,
  end: string,
  tz: string = AGENCY_TZ
): Meeting[] {
  return meetings.filter((m) => {
    const d = localDate(m.starts_at, tz);
    return d >= start && d <= end;
  });
}

/** Meetings from today onward (agency-local), soonest first. */
export function upcomingMeetings(
  meetings: Meeting[],
  now: Date,
  tz: string = AGENCY_TZ
): Meeting[] {
  const today = todayDate(now, tz);
  return meetings.filter((m) => localDate(m.starts_at, tz) >= today);
}

/** Human range label, e.g. "Mon 4 Aug, 09:00 – 10:00", rendered in `tz`. */
export function formatMeetingRange(startsAt: string, endsAt: string, tz: string): string {
  const start = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));
  const end = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(endsAt));
  return `${start} – ${end}`;
}
