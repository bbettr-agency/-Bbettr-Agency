/**
 * Deterministic My Tasks grouping (pure, no I/O).
 *
 * Places each task in EXACTLY ONE group — no task is ever shown twice. Overdue is
 * a derived warning, not a status: an overdue task is lifted into the Overdue
 * group and removed from Planned/Scheduled/In Progress. Waiting tasks always stay
 * in Waiting/Blocked (visible but not actionable) even when overdue — the row
 * still surfaces the overdue warning via `view.isOverdue`.
 *
 * Group order (locked): Overdue → In Progress → Scheduled → Planned → Waiting/Blocked.
 * Within a group, tasks are sorted by priority, then due date, then scheduled
 * date, then title — a stable, deterministic order.
 */
import type { TaskView } from "./task-view";
import type { TaskPriority } from "@/lib/database.types";

export type MyTaskGroupKey = "overdue" | "in_progress" | "scheduled" | "planned" | "waiting";

export interface MyTaskGroup {
  key: MyTaskGroupKey;
  label: string;
  tasks: TaskView[];
}

const ORDER: { key: MyTaskGroupKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "in_progress", label: "In Progress" },
  { key: "scheduled", label: "Scheduled" },
  { key: "planned", label: "Planned" },
  { key: "waiting", label: "Waiting / Blocked" },
];

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Single-placement bucket for a task. Waiting wins over overdue; else overdue wins over base status. */
function groupFor(v: TaskView): MyTaskGroupKey | null {
  if (v.status === "waiting") return "waiting"; // stays in Waiting even if overdue
  if (v.isOverdue) return "overdue"; // non-waiting overdue → Overdue only
  switch (v.status) {
    case "in_progress":
      return "in_progress";
    case "scheduled":
      return "scheduled";
    case "planned":
      return "planned";
    default:
      return null; // inbox | completed | archived are excluded from My Tasks
  }
}

/** Nulls sort last for ascending date order. */
function cmpDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

function cmpWithin(a: TaskView, b: TaskView): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  const d = cmpDateAsc(a.dueDate, b.dueDate);
  if (d !== 0) return d;
  const s = cmpDateAsc(a.scheduledDate, b.scheduledDate);
  if (s !== 0) return s;
  return a.title.localeCompare(b.title);
}

/** Group views into ordered, non-empty groups with single placement and stable in-group order. */
export function groupMyTasks(views: TaskView[]): MyTaskGroup[] {
  const buckets = new Map<MyTaskGroupKey, TaskView[]>(ORDER.map(({ key }) => [key, []]));
  for (const v of views) {
    const g = groupFor(v);
    if (g) buckets.get(g)!.push(v);
  }
  return ORDER.map(({ key, label }) => ({ key, label, tasks: buckets.get(key)!.slice().sort(cmpWithin) })).filter((g) => g.tasks.length > 0);
}
