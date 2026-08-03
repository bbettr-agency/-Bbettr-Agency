/**
 * The small, stable result contract every future Tasks UI Server Action returns.
 *
 * Pure types (no I/O). A result is either a success carrying the safe outcome +
 * resulting identity/version, or a failure carrying a typed error code and a
 * SAFE human-readable message. Raw database response objects, SQL, payloads,
 * env values and stack traces are NEVER surfaced through this shape.
 */
import type { TaskErrorCode } from "./errors";

/** Stored command outcomes plus the return-only `replayed` result. */
export type TaskActionOutcome = "applied" | "accepted_noop" | "replayed";

export interface TaskActionSuccess {
  ok: true;
  outcome: TaskActionOutcome;
  /** Resulting task id (present for every command the adapter returns). */
  taskId: string;
  /** Resulting aggregate version after the command committed. */
  aggregateVersion: number;
}

export interface TaskActionFailure {
  ok: false;
  /** Typed discriminant a UI can branch on (e.g. VersionConflict → prompt reload). */
  code: TaskErrorCode;
  /** Safe, human-readable message — never raw database text. */
  error: string;
}

export type TaskActionResult = TaskActionSuccess | TaskActionFailure;

/**
 * The ONLY Planner paths a task Server Action may revalidate. Callers pass a
 * subset of these; anything outside the whitelist is ignored (a caller can never
 * trigger an arbitrary revalidation). Kept intentionally small and explicit.
 */
export const APPROVED_PLANNER_PATHS = [
  "/admin/planner",
  "/admin/planner/today",
  "/admin/planner/tasks",
  "/admin/planner/inbox",
  "/admin/planner/team",
] as const;

export type ApprovedPlannerPath = (typeof APPROVED_PLANNER_PATHS)[number];

export const isApprovedPlannerPath = (p: string): p is ApprovedPlannerPath =>
  (APPROVED_PLANNER_PATHS as readonly string[]).includes(p);
