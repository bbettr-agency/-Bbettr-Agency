/**
 * `TaskView` — the shared, page-agnostic, presentation-safe projection of a Task.
 *
 * This is the frozen seam every Planner page's task rows consume (My Tasks first,
 * then Today/Calendar/Team/Dashboard). Components NEVER receive the raw `Task`
 * row; they receive a `TaskView`. That keeps the read layer free to evolve behind
 * a stable UI contract and guarantees no privileged/raw field leaks into a client.
 *
 * Real data only — every field maps to a genuine column or a deterministically
 * derived flag. Nothing here fabricates task times, due times, clients, progress,
 * descriptions, assignees or deadlines. `isOverdue` is DERIVED (never stored) via
 * the pure Today-membership rule; owner/assignee names are best-effort (null when
 * unresolved). `aggregateVersion` travels for optimistic concurrency on writes.
 */
import type { Task, TaskPriority, TaskStatus } from "@/lib/database.types";
import { isOverdue } from "./today-membership";

export interface TaskView {
  id: string;
  title: string;
  /** Real lifecycle status (drives the status badge AND the legal-action set). */
  status: TaskStatus;
  priority: TaskPriority;
  /** Only when priority is critical AND a real reason exists; else null. */
  criticalReason: string | null;
  /** The task's description (carried so Edit can prefill/diff; never a raw row). */
  description: string | null;
  scheduledDate: string | null; // 'YYYY-MM-DD'
  dueDate: string | null; // 'YYYY-MM-DD'
  estimatedMinutes: number | null;
  /** Derived warning condition — due date strictly before today, not terminal. */
  isOverdue: boolean;
  /** status === 'waiting' — a blocked/non-actionable task. */
  isWaiting: boolean;
  /** When waiting, the instant the task became blocked (for a "waiting since" hint). */
  blockedSince: string | null;
  /** Best-effort resolved name; null when unavailable (never fabricated). */
  ownerDisplay: string | null;
  assigneeDisplay: string | null;
  /** status === 'completed' — carried so Today can show a "Completed today" group. */
  isCompleted: boolean;
  /** When completed, the completion instant (ISO); else null. */
  completedAt: string | null;
  /** True when this task is a generated recurring occurrence (recurrence_definition_id set). */
  isRecurring: boolean;
  /** Cadence label (e.g. "Monthly") when resolvable; else null. Drives the "REMINDER · Monthly" tag. */
  recurrenceLabel: string | null;
  aggregateVersion: number;
  /**
   * True when this view is a PROJECTED (not-yet-materialised) recurring occurrence,
   * derived from the recurrence definition rather than a real task row. Projected
   * views carry no aggregate and expose only a safe Complete (materialise-then-
   * complete); every other lifecycle action is withheld until materialisation.
   */
  isProjected: boolean;
  /** The recurrence identity — always present for recurring/projected views; drives dedupe. */
  recurrenceDefinitionId: string | null;
  occurrenceSlot: string | null;
}

/** Trim a best-effort display name; empty/whitespace → null. */
function displayName(id: string | null, nameById: ReadonlyMap<string, string>): string | null {
  if (!id) return null;
  const n = nameById.get(id);
  return n != null && n.trim().length > 0 ? n.trim() : null;
}

/**
 * Project a Task into a presentation-safe `TaskView`. `nameById` is a best-effort
 * id→name map (one batched lookup upstream — never per-task); a miss yields null
 * and never blocks rendering. `today` (agency-local YYYY-MM-DD) is injected so
 * overdue is deterministic and testable.
 */
export function toTaskView(
  task: Task,
  nameById: ReadonlyMap<string, string>,
  today: string,
  recurrenceLabelById?: ReadonlyMap<string, string>
): TaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    criticalReason: task.priority === "critical" && task.critical_reason != null && task.critical_reason.trim().length > 0 ? task.critical_reason.trim() : null,
    description: task.description,
    scheduledDate: task.scheduled_date,
    dueDate: task.due_date,
    estimatedMinutes: task.estimated_minutes,
    isOverdue: isOverdue(task, today),
    isWaiting: task.status === "waiting",
    blockedSince: task.blocked_since,
    ownerDisplay: displayName(task.owner_user_id, nameById),
    assigneeDisplay: displayName(task.assignee_id, nameById),
    isCompleted: task.status === "completed",
    completedAt: task.completed_at,
    isRecurring: task.recurrence_definition_id != null,
    recurrenceLabel: task.recurrence_definition_id != null ? recurrenceLabelById?.get(task.recurrence_definition_id) ?? null : null,
    aggregateVersion: task.aggregate_version,
    isProjected: false,
    recurrenceDefinitionId: task.recurrence_definition_id,
    occurrenceSlot: task.occurrence_slot,
  };
}

/** The presentation fields a projected occurrence needs from its definition. */
export interface ProjectedViewDefinition {
  id: string;
  title: string;
  priority: TaskPriority;
  ownerUserId: string;
  assigneeId: string | null;
  recurrenceLabel: string | null;
}

/**
 * Build a presentation-safe `TaskView` for a PROJECTED occurrence (no task row yet).
 * It looks and sorts like a scheduled recurring reminder — `isRecurring` true so it
 * carries the "Reminder · <cadence>" tag — but is flagged `isProjected` so the row
 * offers only the safe materialise-then-complete action. The synthetic `id`
 * encodes the durable identity so React keys stay stable and the Complete control
 * can target `(definitionId, slot)`. No aggregate exists, so `aggregateVersion` is
 * 0 and must never be used for an optimistic write.
 */
export function projectedOccurrenceToTaskView(
  occ: { definitionId: string; slot: string; scheduledDate: string; dueDate: string; isOverdue: boolean },
  def: ProjectedViewDefinition,
  nameById: ReadonlyMap<string, string>
): TaskView {
  return {
    id: `proj:${occ.definitionId}:${occ.slot}`,
    title: def.title,
    status: "scheduled",
    priority: def.priority,
    criticalReason: null,
    description: null,
    scheduledDate: occ.scheduledDate,
    dueDate: occ.dueDate,
    estimatedMinutes: null,
    isOverdue: occ.isOverdue,
    isWaiting: false,
    blockedSince: null,
    ownerDisplay: displayName(def.ownerUserId, nameById),
    assigneeDisplay: displayName(def.assigneeId, nameById),
    isCompleted: false,
    completedAt: null,
    isRecurring: true,
    recurrenceLabel: def.recurrenceLabel,
    aggregateVersion: 0,
    isProjected: true,
    recurrenceDefinitionId: occ.definitionId,
    occurrenceSlot: occ.slot,
  };
}
