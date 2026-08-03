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
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { TaskError } from "@/lib/planner/tasks/errors";
import type { ApprovedPlannerPath, TaskActionResult } from "@/lib/planner/tasks/action-result";
import type { TaskPriority } from "@/lib/database.types";

const INBOX_REVALIDATE: ApprovedPlannerPath[] = ["/admin/planner/inbox", "/admin/planner"];

const failWith = (code: "NotAuthenticated" | "InvalidCommand"): TaskActionResult => {
  const e = new TaskError(code);
  return { ok: false, code: e.code, error: e.message };
};

/** Strict agency date: `YYYY-MM-DD` AND a real calendar day (rejects 2026-13-01, 2026-02-30). */
function isValidAgencyDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The workspace-scoped, admin authenticated actor performing the action. */
async function currentAdminId(): Promise<string | null> {
  return (await getCurrentProfile())?.id ?? null;
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
 * Triage an Inbox task → Planned. The owner is ALWAYS the authenticated admin
 * performing the triage (the browser cannot choose an owner). Choosing another
 * owner is a later, separately-approved team-assignment feature.
 */
export async function triageTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  const ownerUserId = await currentAdminId();
  if (!ownerUserId) return failWith("NotAuthenticated");
  return runTaskCommand(
    {
      command: { type: "TriageTask", owner_user_id: ownerUserId, ...(input.priority ? { priority: input.priority } : {}) },
      task_id: input.taskId,
      expected_aggregate_version: input.expectedAggregateVersion,
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}

/**
 * Triage-and-schedule an Inbox task → Scheduled (the only legal Inbox→Scheduled
 * path). Owner is ALWAYS the authenticated admin; assignee is ALWAYS null during
 * Inbox triage (no browser-selected assignment until an approved assignment UI +
 * authorization rule exists). `scheduledDate` is strictly validated first.
 */
export async function triageAndScheduleTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  scheduledDate: string; // agency-local YYYY-MM-DD
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  if (!isValidAgencyDate(input.scheduledDate)) return failWith("InvalidCommand");
  const ownerUserId = await currentAdminId();
  if (!ownerUserId) return failWith("NotAuthenticated");
  return runTaskCommand(
    {
      command: {
        type: "TriageAndScheduleTask",
        owner_user_id: ownerUserId,
        scheduled_date: input.scheduledDate,
        assignee_id: null, // never browser-selected during Inbox triage
        ...(input.priority ? { priority: input.priority } : {}),
      },
      task_id: input.taskId,
      expected_aggregate_version: input.expectedAggregateVersion,
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}
