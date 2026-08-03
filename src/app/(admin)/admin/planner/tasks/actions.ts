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
 */
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { TaskError } from "@/lib/planner/tasks/errors";
import type { ApprovedPlannerPath, TaskActionResult } from "@/lib/planner/tasks/action-result";
import type { TaskPriority } from "@/lib/database.types";

const INBOX_REVALIDATE: ApprovedPlannerPath[] = ["/admin/planner/inbox", "/admin/planner"];

const notAuthenticated = (): TaskActionResult => {
  const e = new TaskError("NotAuthenticated");
  return { ok: false, code: e.code, error: e.message };
};

/** Quick Capture → a new Inbox task. task_id/version are null (create). */
export async function captureTaskAction(input: {
  title: string;
  idempotencyKey: string;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  return runTaskCommand(
    {
      command: { type: "CaptureTask", title: input.title, ...(input.priority ? { priority: input.priority } : {}) },
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}

/**
 * Triage an Inbox task → Planned. Default owner = the current admin (one-click),
 * but an explicit `ownerUserId` may be passed so this extends to choosing another
 * owner later without any architectural change.
 */
export async function triageTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  ownerUserId?: string;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  const ownerUserId = input.ownerUserId ?? (await getCurrentProfile())?.id;
  if (!ownerUserId) return notAuthenticated();
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
 * path). Default owner = the current admin (extensible via `ownerUserId`);
 * assignee policy is explicit — default is to leave it unassigned (null).
 */
export async function triageAndScheduleTaskAction(input: {
  taskId: string;
  expectedAggregateVersion: number;
  idempotencyKey: string;
  scheduledDate: string; // agency-local YYYY-MM-DD
  ownerUserId?: string;
  assigneeId?: string | null;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  const ownerUserId = input.ownerUserId ?? (await getCurrentProfile())?.id;
  if (!ownerUserId) return notAuthenticated();
  return runTaskCommand(
    {
      command: {
        type: "TriageAndScheduleTask",
        owner_user_id: ownerUserId,
        scheduled_date: input.scheduledDate,
        assignee_id: input.assigneeId ?? null,
        ...(input.priority ? { priority: input.priority } : {}),
      },
      task_id: input.taskId,
      expected_aggregate_version: input.expectedAggregateVersion,
      idempotency_key: input.idempotencyKey,
    },
    { revalidate: INBOX_REVALIDATE }
  );
}
