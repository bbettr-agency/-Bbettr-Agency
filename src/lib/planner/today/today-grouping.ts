/**
 * Deterministic Today task grouping (pure). Single placement — a task is never
 * shown twice. Placement is status-first so transitions are unambiguous: starting
 * a task moves it to In Progress, blocking it to Waiting, completing it to
 * Completed Today. Active (non-terminal) scheduled/overdue work splits by origin:
 * recurring occurrences (isRecurring) go to Reminders, everything else to To-do's
 * for Today. Overdue tasks are NOT a separate section — they fold into their
 * status/origin bucket and the row itself shows the "Overdue · due X" marker.
 * Completed-today is a separate, pre-filtered input.
 *
 * Sections (locked, in display order): Reminders · To-do's for Today · In Progress ·
 * Waiting / Blocked · Completed Today. Meetings are rendered above these, outside
 * this module. `alwaysShow` sections render even when empty (with `emptyLabel`);
 * Waiting/Blocked is shown only when it has tasks.
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskPriority } from "@/lib/database.types";

export type TodayGroupKey = "reminders" | "todos" | "in_progress" | "waiting" | "completed_today";

export interface TodayGroup {
  key: TodayGroupKey;
  label: string;
  tasks: TaskView[];
  /** Shown inside the card when the section is visible but empty. */
  emptyLabel: string;
  /** When true the section renders even with zero tasks (day-at-a-glance). */
  alwaysShow: boolean;
}

const ORDER: { key: TodayGroupKey; label: string; emptyLabel: string; alwaysShow: boolean }[] = [
  { key: "reminders", label: "Reminders", emptyLabel: "No reminders due today.", alwaysShow: true },
  { key: "todos", label: "To-do's for Today", emptyLabel: "Nothing scheduled for today.", alwaysShow: true },
  { key: "in_progress", label: "In Progress", emptyLabel: "Nothing in progress.", alwaysShow: true },
  { key: "waiting", label: "Waiting / Blocked", emptyLabel: "", alwaysShow: false },
  { key: "completed_today", label: "Completed Today", emptyLabel: "Nothing completed yet.", alwaysShow: true },
];

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Single-placement bucket for an ACTIVE Today task (never completed here). */
function activeGroupFor(v: TaskView): Exclude<TodayGroupKey, "completed_today"> {
  if (v.status === "waiting") return "waiting";
  if (v.status === "in_progress") return "in_progress";
  // planned or scheduled (may be overdue): split by origin.
  return v.isRecurring ? "reminders" : "todos";
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

/**
 * Group active Today members + completed-today into the ordered sections. Unlike
 * the old behaviour, EMPTY sections are retained (the renderer decides visibility
 * via `alwaysShow`), so the page shows the whole day at a glance.
 */
export function groupToday(active: TaskView[], completedToday: TaskView[]): TodayGroup[] {
  const buckets = new Map<TodayGroupKey, TaskView[]>(ORDER.map(({ key }) => [key, []]));
  for (const v of active) buckets.get(activeGroupFor(v))!.push(v);
  buckets.set(
    "completed_today",
    completedToday.slice().sort((a, b) => cmpDateAsc(b.completedAt, a.completedAt)) // most recently completed first
  );
  for (const key of ["reminders", "todos", "in_progress", "waiting"] as const) buckets.get(key)!.sort(cmpActive);
  return ORDER.map((g) => ({ ...g, tasks: buckets.get(g.key)! }));
}

/** Actionable Today tasks (active, non-waiting, non-completed) — the queue NBA/progress use. */
export function actionableToday(active: TaskView[]): TaskView[] {
  return active.filter((v) => v.status !== "waiting");
}
