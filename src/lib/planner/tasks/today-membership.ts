/**
 * Pure Today-membership rules (no I/O, no ambient clock).
 *
 * Locked contract: a task is on Today iff `scheduled_date == today` OR it is
 * DUE today (`due_date == today`) OR it is overdue (`due_date < today`), in the
 * agency timezone (Africa/Johannesburg) — equivalently `scheduled_date == today`
 * OR `due_date <= today`. This is why a recurring reminder/invoice with a due
 * offset (scheduled earlier, due later) still appears on its actual due date
 * rather than vanishing for a day and returning as "overdue". The agency-local
 * `today` (YYYY-MM-DD) is injected by the caller (computed via the Planner date
 * utilities) — this module never reads the system clock. Ranking, grouping,
 * progress and Next-Best-Action are intentionally NOT here (Today product phase).
 */
import type { TaskStatus } from "@/lib/database.types";

/** The minimal task shape these rules need (a subset of the tasks Row). */
export interface TodayTaskLike {
  status: TaskStatus;
  scheduled_date: string | null; // 'YYYY-MM-DD'
  due_date: string | null; // 'YYYY-MM-DD'
  deleted_at: string | null;
}

const TERMINAL: TaskStatus[] = ["completed", "archived"];

/** Overdue = has a due date strictly before today and not completed/archived. Derived, never stored. */
export function isOverdue(task: TodayTaskLike, todayAgency: string): boolean {
  return task.due_date != null && task.due_date < todayAgency && !TERMINAL.includes(task.status);
}

export function isScheduledToday(task: TodayTaskLike, todayAgency: string): boolean {
  return task.scheduled_date === todayAgency;
}

/** Due today = has a due date equal to today and not completed/archived. Distinct
 *  from overdue (strictly before today), so a due-today task is a Today member but
 *  is NOT flagged "Overdue". Derived, never stored. */
export function isDueToday(task: TodayTaskLike, todayAgency: string): boolean {
  return task.due_date === todayAgency && !TERMINAL.includes(task.status);
}

/** Today membership: scheduled today OR due today OR overdue (i.e. scheduled today
 *  OR due on/before today). Deleted rows are never members. */
export function isTodayMember(task: TodayTaskLike, todayAgency: string): boolean {
  if (task.deleted_at != null) return false;
  return isScheduledToday(task, todayAgency) || isDueToday(task, todayAgency) || isOverdue(task, todayAgency);
}

/** Active-queue eligibility: excludes deleted, completed, archived and Waiting. */
export function isActiveQueueEligible(task: TodayTaskLike): boolean {
  return task.deleted_at == null && task.status !== "completed" && task.status !== "archived" && task.status !== "waiting";
}

/**
 * Partition a set of tasks for Today: the actionable queue (excludes Waiting)
 * and the separate Waiting bucket. Both are drawn only from Today members.
 */
export function partitionToday<T extends TodayTaskLike>(
  tasks: T[],
  todayAgency: string
): { queue: T[]; waiting: T[] } {
  const members = tasks.filter((t) => isTodayMember(t, todayAgency));
  return {
    queue: members.filter((t) => isActiveQueueEligible(t)),
    waiting: members.filter((t) => t.deleted_at == null && t.status === "waiting"),
  };
}
