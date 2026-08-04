/**
 * Deterministic Today task grouping (pure). Single placement — a task is never
 * shown twice. Overdue is a derived warning, not a status: an overdue (non-waiting)
 * task is lifted into Overdue and removed from Planned/In Progress. Waiting always
 * stays in Waiting/Blocked (visible, not actionable) even when overdue. Completed-
 * today tasks are a separate, pre-filtered input.
 *
 * Groups (locked, in display order): Overdue · In Progress · Planned for today ·
 * Completed today · Waiting / Blocked.
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskPriority } from "@/lib/database.types";

export type TodayGroupKey = "overdue" | "in_progress" | "planned_today" | "completed_today" | "waiting";

export interface TodayGroup {
  key: TodayGroupKey;
  label: string;
  tasks: TaskView[];
}

const ORDER: { key: TodayGroupKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "in_progress", label: "In Progress" },
  { key: "planned_today", label: "Planned for today" },
  { key: "completed_today", label: "Completed today" },
  { key: "waiting", label: "Waiting / Blocked" },
];

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function activeGroupFor(v: TaskView): Exclude<TodayGroupKey, "completed_today"> | null {
  if (v.status === "waiting") return "waiting";
  if (v.isOverdue) return "overdue";
  if (v.status === "in_progress") return "in_progress";
  if (v.status === "planned" || v.status === "scheduled") return "planned_today";
  return null;
}

function cmpDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}
function cmpActive(a: TaskView, b: TaskView): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  const d = cmpDateAsc(a.dueDate, b.dueDate);
  if (d !== 0) return d;
  const s = cmpDateAsc(a.scheduledDate, b.scheduledDate);
  if (s !== 0) return s;
  return a.title.localeCompare(b.title);
}

/** Group active Today members + completed-today into ordered, non-empty groups. */
export function groupToday(active: TaskView[], completedToday: TaskView[]): TodayGroup[] {
  const buckets = new Map<TodayGroupKey, TaskView[]>(ORDER.map(({ key }) => [key, []]));
  for (const v of active) {
    const g = activeGroupFor(v);
    if (g) buckets.get(g)!.push(v);
  }
  buckets.set(
    "completed_today",
    completedToday.slice().sort((a, b) => cmpDateAsc(b.completedAt, a.completedAt)) // most recently completed first
  );
  for (const key of ["overdue", "in_progress", "planned_today", "waiting"] as const) buckets.get(key)!.sort(cmpActive);
  return ORDER.map(({ key, label }) => ({ key, label, tasks: buckets.get(key)! })).filter((g) => g.tasks.length > 0);
}

/** Actionable Today tasks (active, non-waiting, non-completed) — the queue NBA/progress use. */
export function actionableToday(active: TaskView[]): TaskView[] {
  return active.filter((v) => v.status !== "waiting");
}
