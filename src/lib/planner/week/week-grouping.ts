/**
 * This Week — pure day-bucketing (no I/O, no ambient clock).
 *
 * Buckets the current admin's week-scoped `TaskView`s into an Overdue callout and
 * seven day sections (Mon→Sun). SINGLE PLACEMENT: an overdue task appears ONLY in
 * the Overdue callout (never also in its scheduled day); every other task appears
 * in its scheduled day. Deterministic ordering (priority, then title) so the view
 * is stable and testable. All date facts are injected — this module never reads
 * the clock, so server render and any re-render agree.
 */
import type { TaskPriority } from "@/lib/database.types";
import type { TaskView } from "@/lib/planner/tasks/task-view";

export interface WeekDay {
  date: string; // agency-local YYYY-MM-DD
  tasks: TaskView[];
}

export interface WeekGrouping {
  overdue: TaskView[];
  days: WeekDay[]; // exactly 7, Mon→Sun
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function byPriorityThenTitle(a: TaskView, b: TaskView): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
}

/**
 * The seven agency-local dates (YYYY-MM-DD), Mon→Sun, of the week beginning at
 * `weekStart`. Pure plain-date math in UTC — no timezone, no clock.
 */
export function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Group my week: overdue → the callout only; every non-overdue task → its
 * scheduled day. Each task lands in exactly one place. A task scheduled within the
 * week but overdue belongs to Overdue (it needs attention now), not its day.
 */
export function groupWeek(views: readonly TaskView[], weekStart: string): WeekGrouping {
  const overdue = views.filter((v) => v.isOverdue).sort(byPriorityThenTitle);
  const days = weekDates(weekStart).map((date) => ({
    date,
    tasks: views.filter((v) => !v.isOverdue && v.scheduledDate === date).sort(byPriorityThenTitle),
  }));
  return { overdue, days };
}
