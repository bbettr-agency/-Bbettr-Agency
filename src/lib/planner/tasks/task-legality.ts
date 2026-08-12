/**
 * Legal-action descriptors for the shared Task Kit (pure, no I/O).
 *
 * Given a task's REAL lifecycle status, returns the ordered set of V1 actions the
 * UI may render for it. This is a deterministic, server-computed subset of what
 * the state machine permits — the STATE MACHINE remains the sole authority on
 * transition legality. The browser never decides legality: it renders only what
 * this descriptor allows, and any command it sends is re-validated by the state
 * machine (an illegal transition → IllegalTransition → safe failure).
 *
 * Waiting deliberately offers only Unblock/Drop — a waiting task is visible but
 * NOT actionable work. Completed/archived/inbox have no My Tasks V1 controls
 * (Reopen/Restore/capture live outside this workspace).
 */
import type { TaskStatus } from "@/lib/database.types";

export type TaskActionKey =
  | "start" | "complete" | "schedule" | "reschedule" | "unschedule" | "defer" | "block" | "unblock" | "drop" | "delete";

/**
 * How the control renders: a single-click command, an inline date, an inline
 * block form, or a destructive delete guarded by an inline confirm.
 */
export type TaskActionKind = "instant" | "date" | "block" | "delete";

export interface TaskActionDescriptor {
  key: TaskActionKey;
  kind: TaskActionKind;
}

const A = (key: TaskActionKey, kind: TaskActionKind): TaskActionDescriptor => ({ key, kind });

/**
 * The ordered legal V1 actions for a status. Order is the intended button order.
 * Mirrors the state-machine allowed-from sets, then appends Delete last:
 *   planned      → Start, Schedule, Complete, Block, Drop, Delete
 *   scheduled    → Start, Reschedule, Unschedule, Complete, Block, Drop, Delete
 *   in_progress  → Complete, Defer, Block, Drop, Delete
 *   waiting      → Unblock, Drop, Delete   (Complete-from-waiting is engine-legal
 *                                   but not surfaced: waiting is not actionable work)
 *
 * Delete is NOT a state-machine transition: it permanently erases the task
 * (removes it from every view) rather than moving it to another status. It is
 * offered last, visually separated as a destructive action, on every ACTIVE
 * status. inbox/completed/archived intentionally expose no My Tasks controls at
 * all (capture/reopen/restore live elsewhere), so erase is not surfaced there.
 */
export function legalActionsFor(status: TaskStatus): TaskActionDescriptor[] {
  switch (status) {
    case "planned":
      return [A("start", "instant"), A("schedule", "date"), A("complete", "instant"), A("block", "block"), A("drop", "instant"), A("delete", "delete")];
    case "scheduled":
      return [A("start", "instant"), A("reschedule", "date"), A("unschedule", "instant"), A("complete", "instant"), A("block", "block"), A("drop", "instant"), A("delete", "delete")];
    case "in_progress":
      return [A("complete", "instant"), A("defer", "instant"), A("block", "block"), A("drop", "instant"), A("delete", "delete")];
    case "waiting":
      return [A("unblock", "instant"), A("drop", "instant"), A("delete", "delete")];
    default:
      return []; // inbox | completed | archived: no My Tasks V1 controls
  }
}

/**
 * The single PRIMARY action a row surfaces beside the Actions menu:
 * Complete for active work (planned/scheduled/in_progress), Unblock for waiting,
 * none for statuses with no controls. Every other legal action lives in the menu.
 * Pure — the state machine still re-validates whatever the row dispatches.
 */
export function primaryActionKey(status: TaskStatus): TaskActionKey | null {
  const legal = legalActionsFor(status);
  if (legal.length === 0) return null;
  if (status === "waiting") return "unblock";
  return legal.some((a) => a.key === "complete") ? "complete" : null;
}

/** Human labels for the action buttons (kept with the descriptor so pages stay consistent). */
export const TASK_ACTION_LABEL: Record<TaskActionKey, string> = {
  start: "Start",
  complete: "Complete",
  schedule: "Schedule",
  reschedule: "Reschedule",
  unschedule: "Unschedule",
  defer: "Defer",
  block: "Block",
  unblock: "Unblock",
  drop: "Drop",
  delete: "Delete",
};
