import "server-only";

/**
 * Authenticated Tasks command adapter — the internal application service that is
 * the ONLY legal path from a request to a task write. Not a route, not a Server
 * Action, not browser-callable; later phases wire an authenticated endpoint on
 * top of this.
 *
 * SECURITY (locked): untrusted input carries only the command + command-specific
 * data + a required idempotency key + the optimistic version it was formed
 * against. The trusted actor identity and workspace are resolved INTERNALLY from
 * the real authenticated request context and can never be supplied by the
 * caller. Reads use the authenticated/RLS client; the single privileged write
 * goes through the narrow service-role module.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
import type { CommandActor, TaskCommandEnvelope, TaskCommandResult } from "@/lib/database.types";
import { TaskError, mapDbError } from "./errors";
import { evaluate, type TaskCommand, type TaskSnapshot } from "./state-machine";
import { canonicalCommandHash } from "./payload-hash";
import { invokeApplyTaskCommand } from "./service-role-operations";

export interface DispatchTaskCommandInput {
  /** The bounded command + its command-specific user input (never actor/workspace). */
  command: TaskCommand;
  /** Target task (required for every command except CaptureTask). */
  task_id?: string | null;
  /** Optimistic version the command was formed against (required for non-create). */
  expected_aggregate_version?: number | null;
  /** REQUIRED retry identity. One key per user intent; every retry reuses it. */
  idempotency_key: string;
  /** Optional request/chain grouping id (never actor identity). */
  correlation_id?: string | null;
}

const IDEMPOTENCY_KEY_MAX = 200;
const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== "string") throw new TaskError("InvalidCommand", "A non-empty idempotency_key is required.");
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > IDEMPOTENCY_KEY_MAX) {
    throw new TaskError("InvalidCommand", "idempotency_key must be a non-empty string of at most 200 characters.");
  }
}

/** Stable, non-empty display name for the event actor snapshot. */
function displayName(profile: { full_name: string | null; email: string | null }): string {
  return profile.full_name?.trim() || profile.email?.trim() || "Admin";
}

export async function dispatchTaskCommand(input: DispatchTaskCommandInput): Promise<TaskCommandResult> {
  // 1 — feature flag gates every entry point.
  if (!isTasksEnabled()) throw new TaskError("TasksDisabled");

  // 8 (validated early) — retry identity, treated as untrusted opaque input.
  assertIdempotencyKey(input.idempotency_key);

  // 2–3 — resolve the authenticated actor from the real request context; confirm admin.
  const profile = await getCurrentProfile();
  if (!profile) throw new TaskError("NotAuthenticated");
  if (profile.role !== "admin") throw new TaskError("NotAuthorized");

  const supabase = await createClient();

  // 4 — resolve + validate the workspace via the fail-closed RPC (never caller-supplied).
  let workspace_id: string | null;
  {
    const { data, error } = await supabase.rpc("current_workspace_id");
    if (error) throw mapDbError(error);
    workspace_id = data ?? null;
  }
  if (!workspace_id) throw new TaskError("NoWorkspace");

  // 5 — load current task state through the authenticated/RLS path (non-create only).
  const isCreate = input.command.type === "CaptureTask";
  let snapshot: TaskSnapshot | null = null;
  if (!isCreate) {
    if (!nonEmpty(input.task_id)) throw new TaskError("InvalidCommand", "task_id is required for this command.");
    if (input.expected_aggregate_version == null || !Number.isInteger(input.expected_aggregate_version)) {
      throw new TaskError("InvalidCommand", "expected_aggregate_version is required for this command.");
    }
    const { data: task, error } = await supabase
      .from("tasks")
      .select("id,status,owner_user_id,assignee_id,priority,resume_target,scheduled_date,aggregate_version")
      .eq("id", input.task_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!task) throw new TaskError("TaskNotFound");
    snapshot = {
      id: task.id,
      status: task.status,
      owner_user_id: task.owner_user_id,
      assignee_id: task.assignee_id,
      priority: task.priority,
      resume_target: task.resume_target,
      scheduled_date: task.scheduled_date,
      aggregate_version: task.aggregate_version,
    };
  }

  // 6 — evaluate through the pure state machine (throws a typed TaskError if illegal).
  const today = todayDate(new Date(), AGENCY_TZ);
  const plan = evaluate(input.command, snapshot, { today });

  // 7 — build the bounded envelope. Actor + workspace are the internally-derived
  // trusted values; the op owns version + event identity + timestamps.
  const actor: CommandActor = {
    actor_kind: "user",
    actor_user_id: profile.id,
    actor_ref: null,
    actor_display: displayName(profile),
  };
  // 9 — canonical payload hash over the command input (excludes actor/workspace).
  const payload_hash = canonicalCommandHash(input.command);

  const envelope: TaskCommandEnvelope = {
    actor,
    workspace_id,
    command_type: plan.command_type,
    task_id: isCreate ? null : input.task_id ?? null,
    expected_aggregate_version: isCreate ? null : input.expected_aggregate_version ?? null,
    command_idempotency_key: input.idempotency_key,
    payload_hash,
    correlation_id: input.correlation_id ?? null,
    task_field_deltas: plan.task_field_deltas,
    satellite_changes: plan.satellite_changes,
    ordered_events: plan.ordered_events,
    expected_result: { outcome: "applied" },
  };

  // 10–11 — invoke the narrow service-role write; map any failure to a safe typed error.
  try {
    // 12 — result shape is validated inside the narrow module before return.
    return await invokeApplyTaskCommand(envelope);
  } catch (e) {
    throw mapDbError(e);
  }
}
