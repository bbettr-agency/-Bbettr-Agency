"use server";

/**
 * Narrowly-typed Tasks Server Actions for the Inbox (C2.1a).
 *
 * Each action accepts ONLY command-specific user input + the target/version +
 * the caller-supplied idempotency key — never actor identity, workspace,
 * created_by, timestamps, event identity or the resulting version. It builds a
 * bounded DispatchTaskCommandInput and delegates to the C2.0 `runTaskCommand`
 * core, which re-checks the flag, runs the C1 adapter (actor/workspace derived
 * internally, state machine, single service-role write), maps errors to a safe
 * result, and revalidates only approved Planner paths. These are dark while
 * TASKS_ENABLED=false (runTaskCommand returns TasksDisabled); no UI calls them
 * yet — that is C2.1b.
 *
 * AUTHORIZATION BOUNDARY (locked C2.1 product rule). `owner_user_id` and
 * `assignee_id` reference `profiles(id)` with a PLAIN foreign key — the database
 * proves a profile EXISTS but does NOT enforce that it is an admin, or in the
 * caller's workspace. The state machine and op do not restrict the principal's
 * role/workspace either. Therefore the PUBLIC contract must not let the browser
 * choose an owner or assignee: during Inbox triage the owner is ALWAYS the
 * authenticated admin performing the triage, and the assignee stays null. The
 * underlying command/state-machine still supports owner/assignee for a LATER,
 * separately-approved team-assignment UI with its own authorization rule.
 */
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { getActiveBlockersFor } from "@/lib/planner/tasks/read-adapters";
import { TaskError, mapDbError } from "@/lib/planner/tasks/errors";
import { agencyToday, isValidScheduleDate } from "@/lib/planner/tasks/schedule-date";
import { listAdminTeam } from "@/lib/planner/team";
import { isApprovedPlannerPath, type ApprovedPlannerPath, type EraseTaskResult, type TaskActionResult } from "@/lib/planner/tasks/action-result";
import type { Profile, TaskPriority } from "@/lib/database.types";

const INBOX_REVALIDATE: ApprovedPlannerPath[] = ["/admin/planner/inbox", "/admin/planner"];
const MY_TASKS_REVALIDATE: ApprovedPlannerPath[] = ["/admin/planner/tasks", "/admin/planner"];

/** The minimal target every My Tasks lifecycle action needs (never actor/owner/workspace). */
type MyTaskTarget = { taskId: string; expectedAggregateVersion: number; idempotencyKey: string };
const BLOCKER_CLASSES = ["person", "client", "approval", "asset", "dependency"] as const;
type BlockerClassInput = (typeof BLOCKER_CLASSES)[number];

const failWith = (code: "NotAuthenticated" | "NotAuthorized" | "InvalidCommand"): TaskActionResult => {
  const e = new TaskError(code);
  return { ok: false, code: e.code, error: e.message };
};

/** The workspace-scoped, admin authenticated actor performing the action. */
async function currentAdminId(): Promise<string | null> {
  return (await getCurrentProfile())?.id ?? null;
}

/**
 * Resolve the "Assigned to" target to a validated owner id. The browser may name
 * an admin, but the server NEVER trusts that id directly: a non-self candidate
 * must be an admin IN THE CALLER'S WORKSPACE (validated against listAdminTeam,
 * itself workspace-scoped + RLS-safe). The acting admin is always a valid target
 * for their own work; an absent/blank target defaults to the acting admin ("Me").
 * Rejects client/rep ids, cross-workspace admins, and arbitrary profile ids.
 */
async function resolveAssignedOwner(
  profile: Profile,
  assignedToId: string | undefined
): Promise<{ ok: true; ownerId: string } | { ok: false; result: TaskActionResult }> {
  const candidate = typeof assignedToId === "string" && assignedToId.trim().length > 0 ? assignedToId.trim() : profile.id;
  if (candidate === profile.id) return { ok: true, ownerId: profile.id };
  const team = await listAdminTeam(profile.workspace_id);
  if (!team.some((m) => m.id === candidate)) return { ok: false, result: failWith("NotAuthorized") };
  return { ok: true, ownerId: candidate };
}

/** Quick Capture → a new Inbox task. task_id/version are null (create). */
export async function captureTaskAction(input: {
  title: string;
  idempotencyKey: string;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  return runTaskCommand(
    { command: { type: "CaptureTask", title: input.title, ...(input.priority ? { priority: input.priority } : {}) }, idempotency_key: input.idempotencyKey },
    { revalidate: INBOX_REVALIDATE }
  );
}

/**
 * Triage an Inbox task → Planned. "Assigned to" (Slice B): the owner is the
 * acting admin by default ("Me"), OR a chosen admin — `assignedToId` — which the
 * server RE-VALIDATES as a current-workspace admin (never trusting the browser id).
 * A task must have a valid workspace-admin owner before leaving the Inbox.
 */
export async function triageTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  assignedToId?: string; // the admin the work is assigned to; defaults to the actor
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return failWith("NotAuthenticated");
  if (profile.role !== "admin") return failWith("NotAuthorized");
  const owner = await resolveAssignedOwner(profile, input.assignedToId);
  if (!owner.ok) return owner.result;
  return runTaskCommand(
    {
      command: { type: "TriageTask", owner_user_id: owner.ownerId, ...(input.priority ? { priority: input.priority } : {}) },
      task_id: input.taskId,
      expected_aggregate_version: input.expectedAggregateVersion,
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}

/**
 * Triage-and-schedule an Inbox task → Scheduled (the only legal Inbox→Scheduled
 * path). "Assigned to" is the acting admin by default or a server-validated
 * workspace admin (`assignedToId`). assignee stays null at triage — the personal
 * views resolve via owner, and StartTask sets assignee later. `scheduledDate` must
 * be a real TODAY-OR-FUTURE agency day (re-validated so a crafted request cannot
 * bypass the client's min-date rule).
 */
export async function triageAndScheduleTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  scheduledDate: string; // agency-local YYYY-MM-DD
  assignedToId?: string;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  if (!isValidScheduleDate(input.scheduledDate, agencyToday())) return failWith("InvalidCommand");
  const profile = await getCurrentProfile();
  if (!profile) return failWith("NotAuthenticated");
  if (profile.role !== "admin") return failWith("NotAuthorized");
  const owner = await resolveAssignedOwner(profile, input.assignedToId);
  if (!owner.ok) return owner.result;
  return runTaskCommand(
    {
      command: {
        type: "TriageAndScheduleTask",
        owner_user_id: owner.ownerId,
        scheduled_date: input.scheduledDate,
        assignee_id: null, // assignee is set by StartTask, not at triage
        ...(input.priority ? { priority: input.priority } : {}),
      },
      task_id: input.taskId,
      expected_aggregate_version: input.expectedAggregateVersion,
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}

// ── My Tasks lifecycle actions (C-My Tasks) ──────────────────────────────────
// Each is a narrow wrapper: it accepts ONLY the target + command-specific input +
// the caller-minted idempotency key, never actor/owner/workspace. Legality is the
// state machine's authority (an illegal transition → a safe failure result); the
// UI renders only server-computed legal actions but cannot force an illegal one.
// All writes flow client → action → runTaskCommand → dispatchTaskCommand →
// apply_task_command. No owner/assignee is browser-selected.

const withTarget = (input: MyTaskTarget) => ({
  task_id: input.taskId,
  expected_aggregate_version: input.expectedAggregateVersion,
  idempotency_key: input.idempotencyKey,
});

/** Start a task → in_progress. The starter claims it: assignee = the session admin (server-derived). */
export async function startTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  const adminId = await currentAdminId();
  if (!adminId) return failWith("NotAuthenticated");
  return runTaskCommand({ command: { type: "StartTask", assignee_id: adminId }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Complete a task → completed. Legal from planned/scheduled/in_progress (and waiting, engine-side). */
export async function completeTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  return runTaskCommand({ command: { type: "CompleteTask" }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Schedule a planned task → scheduled. Date must be a real today-or-future agency day (re-validated server-side). */
export async function scheduleTaskAction(input: MyTaskTarget & { scheduledDate: string }): Promise<TaskActionResult> {
  if (!isValidScheduleDate(input.scheduledDate, agencyToday())) return failWith("InvalidCommand");
  return runTaskCommand({ command: { type: "ScheduleTask", scheduled_date: input.scheduledDate }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Reschedule a scheduled task (stays scheduled; never touches due_date). Date re-validated server-side. */
export async function rescheduleTaskAction(input: MyTaskTarget & { scheduledDate: string }): Promise<TaskActionResult> {
  if (!isValidScheduleDate(input.scheduledDate, agencyToday())) return failWith("InvalidCommand");
  return runTaskCommand({ command: { type: "RescheduleTask", scheduled_date: input.scheduledDate }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Unschedule a scheduled task → planned (clears the scheduled date). */
export async function unscheduleTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  return runTaskCommand({ command: { type: "UnscheduleTask" }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Defer an in-progress task → planned (stop working; no invented date). */
export async function deferTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  return runTaskCommand({ command: { type: "DeferTask", to: "planned" }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Block a task → waiting. Collects only the command-required class + an optional reason. */
export async function blockTaskAction(input: MyTaskTarget & { blockerClass: BlockerClassInput; reason?: string }): Promise<TaskActionResult> {
  if (!BLOCKER_CLASSES.includes(input.blockerClass)) return failWith("InvalidCommand");
  const reason = typeof input.reason === "string" && input.reason.trim().length > 0 ? input.reason.trim() : null;
  return runTaskCommand(
    { command: { type: "BlockTask", blocker: { blocker_class: input.blockerClass, blocker_key: `manual:${input.idempotencyKey}`, reason } }, ...withTarget(input) },
    { revalidate: MY_TASKS_REVALIDATE }
  );
}

/** Unblock a waiting task → its resume target, resolving its active blockers (one targeted, best-effort read). */
export async function unblockTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  let resolveKeys: string[] = [];
  try {
    resolveKeys = (await getActiveBlockersFor([input.taskId])).map((b) => b.blocker_key);
  } catch {
    resolveKeys = []; // degrade gracefully — the transition still proceeds via the command path
  }
  return runTaskCommand({ command: { type: "UnblockTask", resolve_blocker_keys: resolveKeys }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/** Drop an active task → archived (cancelled). Legal from planned/scheduled/in_progress/waiting. */
export async function dropTaskAction(input: MyTaskTarget): Promise<TaskActionResult> {
  return runTaskCommand({ command: { type: "DropTask" }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/**
 * Reassign an existing task's responsibility to a workspace admin ("Assign to X").
 * One user concept ("Assigned to") over the ChangeOwner command: owner is the
 * responsibility source of truth, and the state machine aligns assignee when one
 * is set so the task moves wholesale to the new admin (and leaves the old admin's
 * personal views). The target is SERVER-validated as a current-workspace admin —
 * never trusted from the browser. expectedAggregateVersion guards concurrency;
 * actor/workspace are derived internally (no service-role shortcut). Legal on any
 * non-archived task (planned/scheduled/in_progress/waiting).
 */
export async function reassignTaskAction(input: MyTaskTarget & { assignedToId: string }): Promise<TaskActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return failWith("NotAuthenticated");
  if (profile.role !== "admin") return failWith("NotAuthorized");
  const owner = await resolveAssignedOwner(profile, input.assignedToId);
  if (!owner.ok) return owner.result;
  return runTaskCommand({ command: { type: "ChangeOwner", owner_user_id: owner.ownerId }, ...withTarget(input) }, { revalidate: MY_TASKS_REVALIDATE });
}

/**
 * Permanently ERASE a task → gone from every view (sets `deleted_at` via the
 * guarded `erase_task` RPC). This is NOT Drop/archive (a dropped task stays in
 * history as 'archived'); it is the exceptional erasure the schema reserves
 * `deleted_at` for. It deliberately does NOT flow through the command path
 * (no state transition, no event, no version): the RPC is SECURITY DEFINER and
 * re-checks `is_admin()` + scopes the target to the caller's workspace, so
 * authorization is enforced in the database as well as here. Idempotent —
 * erasing a missing / already-erased / other-workspace task is a safe no-op.
 *
 * No `expectedAggregateVersion` is taken: erasure is terminal and always wins;
 * a stale row version never changes the intent ("make it gone"). The append-only
 * audit trail is left intact (an invisible forensic row remains; no Portal read
 * surfaces it).
 */
export async function eraseTaskAction(input: { taskId: string }): Promise<EraseTaskResult> {
  if (!isTasksEnabled()) return { ok: false, error: new TaskError("TasksDisabled").message };
  if (typeof input.taskId !== "string" || input.taskId.trim().length === 0) {
    return { ok: false, error: new TaskError("InvalidCommand").message };
  }
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: new TaskError("NotAuthenticated").message };
  if (profile.role !== "admin") return { ok: false, error: new TaskError("NotAuthorized").message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("erase_task", { p_task_id: input.taskId });
  if (error) return { ok: false, error: mapDbError(error).message };

  // Revalidate only approved Planner paths, only after a committed erase.
  for (const path of MY_TASKS_REVALIDATE) {
    if (isApprovedPlannerPath(path)) revalidatePath(path);
  }
  return { ok: true };
}
