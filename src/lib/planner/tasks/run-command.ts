import "server-only";

/**
 * The reusable server-side core the future Inbox / My Tasks / Today Server
 * Actions are built on. It is NOT a `"use server"` export and NOT browser-
 * callable: it takes an already-formed, narrowly-typed command input (produced
 * by a view-specific typed action) and never accepts an arbitrary command
 * envelope from the client.
 *
 * Responsibilities: re-check the feature flag (defense in depth on top of the
 * adapter's own check), invoke the C1 command adapter (which owns all actor /
 * workspace derivation, the state machine, and the single service-role write),
 * map any typed TaskError to the safe TaskActionResult, and revalidate ONLY the
 * caller-supplied paths that appear in the approved whitelist — on success only.
 * No raw SQL/DB message/payload/env/stack is ever surfaced.
 */
import { revalidatePath } from "next/cache";
import { isTasksEnabled } from "@/lib/flags";
import { dispatchTaskCommand, type DispatchTaskCommandInput } from "./command-adapter";
import { TaskError, isTaskError, mapDbError } from "./errors";
import { isApprovedPlannerPath, type ApprovedPlannerPath, type TaskActionResult } from "./action-result";

const fail = (e: TaskError): TaskActionResult => ({ ok: false, code: e.code, error: e.message });

export interface RunTaskCommandOptions {
  /** Planner paths to revalidate on success. Non-whitelisted paths are ignored. */
  revalidate?: ApprovedPlannerPath[];
}

export async function runTaskCommand(
  input: DispatchTaskCommandInput,
  opts: RunTaskCommandOptions = {}
): Promise<TaskActionResult> {
  // Feature flag: refuse before touching the adapter (the adapter re-checks too).
  if (!isTasksEnabled()) return fail(new TaskError("TasksDisabled"));

  try {
    const result = await dispatchTaskCommand(input);
    // Revalidate only approved paths, only after a committed command.
    for (const path of opts.revalidate ?? []) {
      if (isApprovedPlannerPath(path)) revalidatePath(path);
    }
    return {
      ok: true,
      outcome: result.outcome,
      taskId: result.result_task_id,
      aggregateVersion: result.result_aggregate_version,
    };
  } catch (err) {
    // The adapter already maps DB failures to TaskError; map defensively anyway
    // so nothing raw ever escapes.
    return fail(isTaskError(err) ? err : mapDbError(err));
  }
}
