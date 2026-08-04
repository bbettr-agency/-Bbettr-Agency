/**
 * Pure Today progress (no I/O). Honest about partial estimates — it never invents
 * minutes and reports how many remaining tasks lack an estimate. Meetings are NEVER
 * counted as completed tasks. Waiting/blocked tasks are excluded from the actionable
 * denominator (they are not actionable work).
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";

export interface TodayProgress {
  completed: number; // tasks completed today
  remaining: number; // actionable tasks still to do (active, non-waiting)
  overdue: number; // overdue among remaining
  meetingsRemaining: number;
  totalActionable: number; // completed + remaining
  completionPct: number; // completed / totalActionable (0 when none)
  estimatedRemainingMinutes: number; // sum of estimates for remaining tasks that HAVE one
  remainingWithoutEstimate: number; // remaining tasks with no estimate (honesty)
}

/**
 * @param remaining actionable remaining tasks (active, non-waiting, non-completed)
 * @param completedToday tasks completed today
 * @param meetingsRemaining meetings still to come today
 */
export function todayProgress(remaining: TaskView[], completedToday: TaskView[], meetingsRemaining: number): TodayProgress {
  const completed = completedToday.length;
  const rem = remaining.length;
  const total = completed + rem;
  const withEstimate = remaining.filter((t) => t.estimatedMinutes != null);
  return {
    completed,
    remaining: rem,
    overdue: remaining.filter((t) => t.isOverdue).length,
    meetingsRemaining,
    totalActionable: total,
    completionPct: total === 0 ? 0 : Math.round((completed / total) * 100),
    estimatedRemainingMinutes: withEstimate.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
    remainingWithoutEstimate: rem - withEstimate.length,
  };
}
