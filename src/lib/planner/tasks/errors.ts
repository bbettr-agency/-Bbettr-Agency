/**
 * Typed Planner-Tasks application errors + a central database-error mapper.
 *
 * Pure module (no I/O). Callers branch on `error.code`; user-facing layers may
 * surface `error.message` — every message here is SAFE (no SQL, no raw database
 * text, no credentials, no payloads, no stack detail). Raw driver errors are
 * NEVER re-thrown to callers; `mapDbError` converts an opaque database failure
 * into a typed, safe `TaskError` by SQLSTATE.
 */

export type TaskErrorCode =
  // Domain / lifecycle (state machine + DB backstops)
  | "IllegalTransition"
  | "MissingOwner"
  | "MissingAssignee"
  | "ActiveChildren"
  | "DependencyCycle"
  | "ArchivedLabel"
  // Persistence op (apply_task_command)
  | "VersionConflict"
  | "IdempotencyConflict"
  | "EventContractViolation"
  | "TaskNotFound"
  | "CrossWorkspaceReference"
  // Application boundary (adapter)
  | "TasksDisabled"
  | "NotAuthenticated"
  | "NotAuthorized"
  | "NoWorkspace"
  | "InvalidCommand"
  // Safe catch-all for an unmapped/unexpected database failure
  | "PersistenceError";

const SAFE_MESSAGE: Record<TaskErrorCode, string> = {
  IllegalTransition: "That action is not allowed from the task's current state.",
  MissingOwner: "This task needs an owner before it can be triaged.",
  MissingAssignee: "This task needs an assignee before it can be started.",
  ActiveChildren: "This task cannot be completed while it has active subtasks.",
  DependencyCycle: "That dependency would create a cycle and is not allowed.",
  ArchivedLabel: "That label is archived and cannot be added to a task.",
  VersionConflict: "This task changed since you loaded it. Reload and try again.",
  IdempotencyConflict: "This request key was already used for a different command.",
  EventContractViolation: "The command did not satisfy the persistence contract.",
  TaskNotFound: "That task could not be found in your workspace.",
  CrossWorkspaceReference: "A referenced record is outside your workspace.",
  TasksDisabled: "The Tasks module is not enabled.",
  NotAuthenticated: "You must be signed in to perform this action.",
  NotAuthorized: "You do not have permission to perform this action.",
  NoWorkspace: "Your account is not assigned to a workspace.",
  InvalidCommand: "The command was missing required, well-formed input.",
  PersistenceError: "An unexpected error occurred while saving. Please try again.",
};

export class TaskError extends Error {
  readonly code: TaskErrorCode;
  constructor(code: TaskErrorCode, message?: string) {
    super(message ?? SAFE_MESSAGE[code]);
    this.name = "TaskError";
    this.code = code;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, TaskError.prototype);
  }
}

export const isTaskError = (e: unknown): e is TaskError => e instanceof TaskError;

/**
 * Implemented SQLSTATE → typed error. `BB…` codes are the Planner functions'
 * custom states; `23503`/`23505` are the composite-FK and unique backstops.
 * Anything unmapped becomes a safe `PersistenceError`. The raw database message
 * is intentionally discarded so nothing internal leaks to callers.
 */
const SQLSTATE_MAP: Record<string, TaskErrorCode> = {
  BB460: "VersionConflict",
  BB461: "IdempotencyConflict",
  BB462: "EventContractViolation",
  BB463: "TaskNotFound",
  BB465: "ArchivedLabel",
  BB471: "NotAuthenticated",
  BB472: "NotAuthorized",
  BB473: "NoWorkspace",
  BB371: "IllegalTransition", // one-level-hierarchy guard
  BB372: "ActiveChildren",
  BB390: "DependencyCycle",
  "23503": "CrossWorkspaceReference", // FK violation (same-workspace composite FK)
  "23505": "IdempotencyConflict", // unique receipt under a concurrent duplicate key
};

/** Extract a SQLSTATE-like code from an unknown driver/PostgREST error, if any. */
function sqlstateOf(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return null;
}

/** Convert any database/RPC failure into a safe, typed TaskError. */
export function mapDbError(err: unknown): TaskError {
  if (isTaskError(err)) return err;
  const state = sqlstateOf(err);
  const mapped = state ? SQLSTATE_MAP[state] : undefined;
  return new TaskError(mapped ?? "PersistenceError");
}
