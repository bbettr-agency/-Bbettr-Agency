import "server-only";

/**
 * The ONLY privileged (service-role) write surface for the Tasks domain.
 *
 * Narrowly scoped by design (locked C1 safeguard #2/#3): this module wraps the
 * service-role client internally and exports ONLY the two internal write
 * operations. It exports no Supabase client and no generic query/rpc helper, so
 * nothing else can accidentally obtain privileged, RLS-bypassing access. It is
 * `server-only` (a client import is a build error) and must never be used for
 * ordinary reads — those go through the authenticated/RLS client.
 *
 * Raw driver errors are thrown here unchanged; the command adapter is the single
 * place that maps them to safe typed errors (`mapDbError`) before any caller
 * sees them. Results are shape-validated before being treated as typed.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  EventRedactionInput,
  EventRedactionResult,
  TaskCommandEnvelope,
  TaskCommandResult,
} from "@/lib/database.types";

function assertTaskCommandResult(data: unknown): asserts data is TaskCommandResult {
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { outcome?: unknown }).outcome !== "string" ||
    typeof (data as { result_task_id?: unknown }).result_task_id !== "string" ||
    typeof (data as { result_aggregate_version?: unknown }).result_aggregate_version !== "number"
  ) {
    throw new Error("apply_task_command returned an unexpected result shape");
  }
}

function assertEventRedactionResult(data: unknown): asserts data is EventRedactionResult {
  if (
    !data ||
    typeof data !== "object" ||
    (data as { outcome?: unknown }).outcome !== "applied" ||
    typeof (data as { redaction_id?: unknown }).redaction_id !== "string"
  ) {
    throw new Error("apply_event_redaction returned an unexpected result shape");
  }
}

/** Invoke the internal atomic command-apply op with a fully-formed, trusted envelope. */
export async function invokeApplyTaskCommand(envelope: TaskCommandEnvelope): Promise<TaskCommandResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_task_command", { p_envelope: envelope });
  if (error) throw error;
  assertTaskCommandResult(data);
  return data;
}

/** Invoke the internal append-only redaction-overlay writer. */
export async function invokeEventRedaction(input: EventRedactionInput): Promise<EventRedactionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_event_redaction", { p_envelope: input });
  if (error) throw error;
  assertEventRedactionResult(data);
  return data;
}
