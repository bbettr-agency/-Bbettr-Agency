import "server-only";

/**
 * Privileged SYSTEM command path for recurrence — the ONLY way an occurrence is
 * materialised without a user session. Security-sensitive by design and
 * deliberately tiny: it exports ONE function that constructs a FIXED
 * `RecurringInstanceGenerated` command from a server-trusted definition row and
 * routes it through the same pure state machine + the narrow service-role op.
 *
 * It is NOT a generic service-role task-mutation escape hatch: the caller cannot
 * choose the command, events, status, or arbitrary field deltas — only which
 * definition + slot to generate. Workspace context is taken EXPLICITLY from the
 * trusted definition row (never a browser value); it never reads auth.uid().
 * Idempotency is preserved two ways: a deterministic idempotency key per
 * (definition, slot) and the op's permanent (definition, slot) unique key.
 *
 * created_by must be non-null (tasks CHECK) and task_events forbids a non-null
 * actor_user_id on a non-'user' actor, so the occurrence is attributed to the
 * definition's OWNER (actor_kind 'user'); the distinct RecurringInstanceGenerated
 * event type is what marks it as system-generated.
 */
import type { CommandActor, RecurringDefinition, TaskCommandEnvelope, TaskCommandResult } from "@/lib/database.types";
import { evaluate, type TaskCommand } from "@/lib/planner/tasks/state-machine";
import { canonicalCommandHash } from "@/lib/planner/tasks/payload-hash";
import { invokeApplyTaskCommand } from "@/lib/planner/tasks/service-role-operations";

export interface GenerateOccurrenceInput {
  /** Server-trusted definition row (read via service-role or the authenticated create path). */
  definition: RecurringDefinition;
  /** occurrence_slot — the durable per-occurrence business key (the occurrence date). */
  slot: string;
  /** The task's scheduled_date (agency-local YYYY-MM-DD; usually === slot). */
  scheduledDate: string;
  /** The task's due_date (scheduled_date + due_offset_days). */
  dueDate: string;
  /** Display snapshot for the event actor (the owner's name). */
  ownerDisplay: string;
}

/** Idempotency key for one (definition, slot) generation — deterministic ⇒ replay-safe. */
export function occurrenceIdempotencyKey(definitionId: string, slot: string): string {
  return `recur:${definitionId}:${slot}`;
}

export async function generateOccurrence(input: GenerateOccurrenceInput): Promise<TaskCommandResult> {
  const { definition, slot, scheduledDate, dueDate, ownerDisplay } = input;
  if (!definition.workspace_id) throw new Error("recurrence: definition has no workspace_id");
  if (!definition.owner_user_id) throw new Error("recurrence: definition has no owner_user_id");

  const command: Extract<TaskCommand, { type: "RecurringInstanceGenerated" }> = {
    type: "RecurringInstanceGenerated",
    title: definition.template_title,
    owner_user_id: definition.owner_user_id,
    assignee_id: definition.default_assignee_id ?? null,
    client_id: definition.template_client_id ?? null,
    scheduled_date: scheduledDate,
    due_date: dueDate,
    priority: definition.template_priority,
    recurrence_definition_id: definition.id,
    occurrence_slot: slot,
  };

  // The pure state machine builds the whitelisted plan (create → 'scheduled').
  const plan = evaluate(command);

  // Attributed to the owner (valid created_by); system origin is the event type.
  const actor: CommandActor = {
    actor_kind: "user",
    actor_user_id: definition.owner_user_id,
    actor_ref: null,
    actor_display: ownerDisplay,
  };

  const envelope: TaskCommandEnvelope = {
    actor,
    workspace_id: definition.workspace_id, // EXPLICIT trusted context — never browser-supplied
    command_type: plan.command_type,
    task_id: null,
    expected_aggregate_version: null,
    command_idempotency_key: occurrenceIdempotencyKey(definition.id, slot),
    payload_hash: canonicalCommandHash(command),
    correlation_id: null,
    task_field_deltas: plan.task_field_deltas,
    satellite_changes: plan.satellite_changes,
    ordered_events: plan.ordered_events,
    expected_result: { outcome: "applied" },
  };

  return invokeApplyTaskCommand(envelope);
}
