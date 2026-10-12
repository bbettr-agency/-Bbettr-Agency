import "server-only";

import { getTodayWorkspace } from "@/lib/planner/tasks/read-adapters";
import { toTaskView, type TaskView } from "@/lib/planner/tasks/task-view";
import { getRecurrenceLabels } from "@/lib/planner/recurrence/recurrence-read";
import { loadViewerProjectionContext, projectViewerOccurrences } from "@/lib/planner/recurrence/projected-read";
import { buildTodaySummary, type TodayTaskSummary } from "./today-summary";

/**
 * SERVER composition for the authoritative Today task summary. Runs the SAME loaders the
 * Planner Today dashboard uses (getTodayWorkspace — owner|assignee, Africa/Johannesburg,
 * Today membership — plus recurring projections), under the caller's admin+workspace RLS
 * (never service-role), then summarises via the shared PURE `buildTodaySummary`. No new
 * query or definition of "today" is introduced. Throws TaskError when the Tasks module is
 * disabled (callers map that to an UNAVAILABLE coverage signal).
 *
 * `viewerId` is the authenticated admin (owner|assignee scope); it must match the
 * principal getTodayWorkspace itself resolves — in both call sites (dashboard, Jarvis)
 * that is the current signed-in admin.
 */
export async function getTodayTaskSummary(now: Date, viewerId: string): Promise<TodayTaskSummary> {
  const names = new Map<string, string>(); // display names affect labels only, never counts/titles
  const ws = await getTodayWorkspace(now);
  const today = ws.today;
  const recurrenceLabels = await getRecurrenceLabels([...ws.active, ...ws.completedToday].map((t) => t.recurrence_definition_id)).catch(() => new Map<string, string>());
  const materialisedViews = ws.active.map((t) => toTaskView(t, names, today, recurrenceLabels));
  const completedViews = ws.completedToday.map((t) => toTaskView(t, names, today, recurrenceLabels));
  const projectedViews = await loadViewerProjectionContext(viewerId)
    .then((ctx) => projectViewerOccurrences(ctx, today, today, names))
    .catch(() => [] as TaskView[]);
  const activeViews = [...materialisedViews, ...projectedViews];
  return buildTodaySummary(today, activeViews, completedViews);
}
