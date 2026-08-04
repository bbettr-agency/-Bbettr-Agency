/**
 * Pure Today greeting + evening-mode logic (no I/O; `now` injected).
 *
 * Time-of-day is computed in the agency timezone (Africa/Johannesburg). The
 * workload sentence is built from REAL counts only — it never invents numbers and
 * pluralises honestly. Evening mode flips on at ~17:00 agency time.
 */
import { AGENCY_TZ } from "@/lib/planner/meetings/date-views";

/** The hour (0–23) of `now` in the agency timezone. */
export function agencyHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: AGENCY_TZ, hour: "2-digit", hour12: false }).format(now)) % 24;
}

export function salutationFor(now: Date): "Good morning" | "Good afternoon" | "Good evening" {
  const h = agencyHour(now);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Evening mode begins at ~17:00 agency time. */
export function isEvening(now: Date): boolean {
  return agencyHour(now) >= 17;
}

/** First token of a full name; empty/whitespace → null (never fabricated). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  if (fullName == null) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/** Full agency date label, e.g. "Monday, 4 August". */
export function agencyDateLabel(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: AGENCY_TZ, weekday: "long", day: "numeric", month: "long" }).format(now);
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export interface WorkloadCounts {
  tasks: number; // actionable tasks remaining today (excludes waiting + completed)
  meetings: number; // meetings remaining today
  overdue: number; // overdue tasks
}

/**
 * One concise workload sentence, e.g.
 * "You have 5 tasks, 2 meetings and 1 overdue item today." Overdue clause is
 * dropped when zero; an all-zero workload yields the caught-up sentence.
 */
export function workloadSentence(c: WorkloadCounts): string {
  if (c.tasks === 0 && c.meetings === 0 && c.overdue === 0) return "You're all caught up for today.";
  const parts = [plural(c.tasks, "task"), plural(c.meetings, "meeting")];
  const lead = `You have ${parts[0]} and ${parts[1]}`;
  return c.overdue > 0 ? `${lead}, with ${plural(c.overdue, "overdue item")}, today.` : `${lead} today.`;
}

export interface Greeting {
  salutation: string;
  firstName: string | null;
  dateLabel: string;
  workload: string;
  evening: boolean;
}

export function buildGreeting(now: Date, fullName: string | null | undefined, counts: WorkloadCounts): Greeting {
  return {
    salutation: salutationFor(now),
    firstName: firstNameOf(fullName),
    dateLabel: agencyDateLabel(now),
    workload: workloadSentence(counts),
    evening: isEvening(now),
  };
}
