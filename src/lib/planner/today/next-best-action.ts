/**
 * Deterministic, explainable Next Best Action (pure — no AI, no randomness).
 *
 * Recommends exactly ONE action: a meeting-prep when the next meeting is imminent,
 * otherwise the single highest-priority actionable task. Waiting/blocked tasks are
 * NEVER candidates (they are excluded upstream via `actionableToday`). Every result
 * carries a plain "why this" explanation and, for a task, the time before the next
 * meeting when one exists.
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskPriority } from "@/lib/database.types";
import { formatCountdown } from "@/lib/planner/meetings/date-views";
import { minutesUntil, nextMeeting, type TodayMeeting } from "./today-meeting";

export type NextBestAction =
  | { kind: "meeting"; meeting: TodayMeeting; minutesUntil: number; why: string }
  | { kind: "task"; task: TaskView; minutesToNextMeeting: number | null; why: string }
  | null;

/** Recommend a meeting-prep when the next meeting starts within this many minutes. */
const MEETING_PREP_WINDOW = 30;

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function cmpDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

/** Deterministic ranking: overdue → priority → in-progress-first → due → scheduled → shorter estimate → title. */
function rankTask(a: TaskView, b: TaskView): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  const inProg = (t: TaskView) => (t.status === "in_progress" ? 0 : 1);
  if (inProg(a) !== inProg(b)) return inProg(a) - inProg(b);
  const d = cmpDateAsc(a.dueDate, b.dueDate);
  if (d !== 0) return d;
  const s = cmpDateAsc(a.scheduledDate, b.scheduledDate);
  if (s !== 0) return s;
  const ea = a.estimatedMinutes ?? Number.POSITIVE_INFINITY;
  const eb = b.estimatedMinutes ?? Number.POSITIVE_INFINITY;
  if (ea !== eb) return ea - eb;
  return a.title.localeCompare(b.title);
}

function whyTask(t: TaskView, minutesToNextMeeting: number | null): string {
  if (t.isOverdue) return t.priority === "critical" || t.priority === "high" ? `Overdue and ${t.priority} priority` : "Overdue — needs attention today";
  if (t.status === "in_progress") return "You're already working on this";
  const lead = t.priority === "critical" || t.priority === "high" ? `${cap(t.priority)}-priority task for today` : "Next task scheduled for today";
  const fits = minutesToNextMeeting != null && t.estimatedMinutes != null && t.estimatedMinutes <= minutesToNextMeeting;
  return fits ? `${lead} — fits before your next meeting` : lead;
}

export function nextBestAction(actionable: TaskView[], meetings: TodayMeeting[], now: Date): NextBestAction {
  const next = nextMeeting(meetings, now);
  const mins = next ? minutesUntil(next.startsAt, now) : null;
  if (next && mins != null && mins <= MEETING_PREP_WINDOW) {
    return { kind: "meeting", meeting: next, minutesUntil: mins, why: `Starting in ${formatCountdown(mins)} — prepare now` };
  }
  const top = actionable.slice().sort(rankTask)[0];
  if (!top) return null;
  return { kind: "task", task: top, minutesToNextMeeting: mins, why: whyTask(top, mins) };
}
