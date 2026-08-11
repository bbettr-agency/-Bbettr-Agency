import "server-only";

/**
 * Service-role recurring-definition writes. `recurring_definitions` RLS is
 * SELECT-only for admins, so create/deactivate MUST go through the service-role
 * client — but only AFTER the calling Server Action has verified an admin session
 * and validated owner/assignee against the workspace (Slice B). These functions
 * TRUST their inputs (workspace/owner come from the server, never a browser) and
 * expose the smallest surface: create + deactivate. No edit path in v1.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { RecurrenceRuleUnit, RecurringDefinition, TaskPriority } from "@/lib/database.types";
import { anchorDayOf } from "./date-engine";

export interface CreateRecurringDefinitionInput {
  workspaceId: string; // trusted (profile.workspace_id) — never browser-supplied
  ownerUserId: string; // a validated current-workspace admin
  assigneeId?: string | null; // validated current-workspace admin, or null
  clientId?: string | null; // real client id, or null (Internal)
  title: string;
  priority: TaskPriority;
  firstDate: string; // agency-local YYYY-MM-DD (today-or-future); the first occurrence slot
  unit: RecurrenceRuleUnit; // 'day' | 'week' | 'month'
  interval?: number; // default 1
}

/**
 * Insert a recurring definition (service-role) and return the row. It does NOT
 * generate occurrences: the recurring-triage action binds the captured inbox task
 * as the FIRST occurrence (via linked triage) and then runs the generator to
 * advance next_occurrence + fill the look-ahead. next_occurrence starts at
 * firstDate so, even if the linking step fails, the generator self-heals (the
 * op's (definition, slot) idempotency makes a re-generated firstDate a no-op).
 */
export async function createRecurringDefinition(
  input: CreateRecurringDefinitionInput
): Promise<RecurringDefinition> {
  const admin = createAdminClient();
  const interval = input.interval ?? 1;
  const anchor_day = input.unit === "month" ? anchorDayOf(input.firstDate) : null;

  const { data, error } = await admin
    .from("recurring_definitions")
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId,
      default_assignee_id: input.assigneeId ?? null,
      template_client_id: input.clientId ?? null,
      template_title: input.title,
      template_priority: input.priority,
      rule_interval: interval,
      rule_unit: input.unit,
      mode: "schedule", // locked v1: calendar-anchored
      missed_policy: "skip", // locked v1: no historical backlog
      due_offset_days: 0,
      next_occurrence: input.firstDate,
      anchor_day,
      active: true,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("recurrence: definition insert failed");
  return data as RecurringDefinition;
}

/**
 * Stop repeating: sets active=false so no further occurrences generate. Already
 * generated occurrences (including a not-yet-due one) are LEFT UNTOUCHED, and
 * completed history is untouched. Workspace-scoped so it can never touch another
 * workspace's definition.
 */
export async function deactivateRecurringDefinition(
  workspaceId: string,
  definitionId: string
): Promise<{ deactivated: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("recurring_definitions")
    .update({ active: false })
    .eq("id", definitionId)
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .select("id");
  if (error) throw error;
  return { deactivated: (data?.length ?? 0) > 0 };
}
