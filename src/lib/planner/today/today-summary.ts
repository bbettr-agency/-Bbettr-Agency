/**
 * PURE Today task summariser (no I/O, no server imports) — THE single authoritative
 * Today calculation, shared by the Planner Today dashboard and Jarvis so they cannot
 * diverge. It wraps the same `actionableToday` + `todayProgress` the UI has always used.
 *
 * This module is intentionally free of server/Next/auth imports so it is unit-testable
 * in the node env and importable from anywhere. The SERVER composition that loads tasks
 * under RLS lives in `today-read-summary.ts`.
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";
import { actionableToday } from "./today-grouping";
import { todayProgress, type TodayProgress } from "./today-progress";

/** Given already-materialised Today views, compute the actionable remaining set and the
 *  progress counts — exactly what the dashboard computes. */
export function summariseTodayTaskViews(
  activeViews: TaskView[],
  completedViews: TaskView[],
  meetingsRemaining: number
): { actionable: TaskView[]; progress: TodayProgress } {
  const actionable = actionableToday(activeViews);
  const progress = todayProgress(actionable, completedViews, meetingsRemaining);
  return { actionable, progress };
}

export interface TodayTaskSummary {
  today: string; // agency-local YYYY-MM-DD used for membership
  totalActionable: number; // completed + remaining (the dashboard "total")
  completed: number; // tasks completed today (agency day)
  remaining: number; // actionable remaining (active, non-waiting, non-completed)
  overdue: number; // overdue among remaining
  waiting: number; // Today members in Waiting (separated, not actionable)
  /** The actual outstanding (remaining) tasks — id + title + dates — not just a count. */
  remainingTasks: { id: string; title: string; scheduledDate: string | null; dueDate: string | null; isOverdue: boolean }[];
}

/** Build the full summary object from materialised views (pure; used by the server
 *  composition and directly by tests). */
export function buildTodaySummary(today: string, activeViews: TaskView[], completedViews: TaskView[]): TodayTaskSummary {
  const { actionable, progress } = summariseTodayTaskViews(activeViews, completedViews, 0);
  const waiting = activeViews.filter((v) => v.isWaiting).length;
  return {
    today,
    totalActionable: progress.totalActionable,
    completed: progress.completed,
    remaining: progress.remaining,
    overdue: progress.overdue,
    waiting,
    remainingTasks: actionable.map((v) => ({ id: v.id, title: v.title, scheduledDate: v.scheduledDate, dueDate: v.dueDate, isOverdue: v.isOverdue })),
  };
}
