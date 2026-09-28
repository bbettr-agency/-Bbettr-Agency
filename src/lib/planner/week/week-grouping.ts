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
 * Group my week: overdue → the callout only; every non-overdue task → one day.
 * A task lands on its scheduled day when that day is in the week; otherwise (no
 * in-week scheduled day) it lands on its DUE day when that is in the week — so a
 * task due this week but scheduled earlier/undated (e.g. a reminder/invoice due
 * today) still appears, on its due day, instead of being dropped. Each task lands
 * in exactly one place; a task scheduled within the week but overdue belongs to
 * Overdue (it needs attention now), not its day.
 */
export function groupWeek(views: readonly TaskView[], weekStart: string): WeekGrouping {
  const dates = weekDates(weekStart);
  const inWeek = new Set(dates);
  const overdue = views.filter((v) => v.isOverdue).sort(byPriorityThenTitle);

  // The single day a non-overdue task belongs to, or null if it falls outside the week.
  const placementDate = (v: TaskView): string | null => {
    if (v.isOverdue) return null;
    if (v.scheduledDate && inWeek.has(v.scheduledDate)) return v.scheduledDate;
    if (v.dueDate && inWeek.has(v.dueDate)) return v.dueDate;
    return null;
  };

  const days = dates.map((date) => ({
    date,
    tasks: views.filter((v) => placementDate(v) === date).sort(byPriorityThenTitle),
  }));
  return { overdue, days };
}
