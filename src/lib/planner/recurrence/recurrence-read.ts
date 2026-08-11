import "server-only";

/**
 * Recurring-definitions read model for the admin management view. Authenticated +
 * RLS-scoped (admins have SELECT on their workspace's definitions) — NO
 * service-role. Presentation-safe: raw definition rows never leave this module.
 * Occurrence history is derived from tasks sharing recurrence_definition_id (no
 * separate history table), in one batched read.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { listAdminTeam } from "@/lib/planner/team";
import { TaskError } from "@/lib/planner/tasks/errors";
import { cadenceLabel } from "./labels";
import type { RecurrenceRuleUnit } from "@/lib/database.types";

const INTERNAL_CLIENT_LABEL = "Internal / No client";

export interface RecurringDefinitionView {
  id: string;
  title: string;
  cadence: string; // "Monthly", …
  ownerName: string;
  clientName: string; // real name or "Internal / No client"
  nextOccurrence: string | null;
  completedCount: number;
  totalCount: number;
}

export interface RecurringDefinitionsData {
  definitions: RecurringDefinitionView[];
}

/**
 * Batched cadence labels for a set of tasks' recurrence_definition_ids →
 * Map<definitionId, "Monthly"|…>. One RLS-scoped read (workspace-bounded); used to
 * render the subtle "REMINDER · Monthly" tag on Today without an N+1.
 */
export async function getRecurrenceLabels(definitionIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(definitionIds.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("recurring_definitions").select("id, rule_unit, rule_interval").in("id", ids);
  for (const d of data ?? []) out.set(d.id, cadenceLabel(d.rule_unit as RecurrenceRuleUnit, d.rule_interval));
  return out;
}

export async function getRecurringDefinitions(): Promise<RecurringDefinitionsData> {
  if (!isTasksEnabled()) throw new TaskError("TasksDisabled");
  const profile = await getCurrentProfile();
  if (!profile) throw new TaskError("NotAuthenticated");
  if (profile.role !== "admin") throw new TaskError("NotAuthorized");
  const supabase = await createClient();

  const [{ data: defs, error }, team, { data: clients }] = await Promise.all([
    supabase
      .from("recurring_definitions")
      .select("id, template_title, template_client_id, owner_user_id, rule_unit, rule_interval, next_occurrence")
      .eq("active", true)
      .order("next_occurrence", { ascending: true }),
    listAdminTeam(profile.workspace_id),
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new TaskError("PersistenceError");

  const rows = defs ?? [];
  const nameById = new Map(team.map((m) => [m.id, m.fullName]));
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.name]));

  // Occurrence stats: one batched read of tasks sharing these definition ids.
  const ids = rows.map((r) => r.id);
  const completedByDef = new Map<string, number>();
  const totalByDef = new Map<string, number>();
  if (ids.length > 0) {
    const { data: occ } = await supabase
      .from("tasks")
      .select("recurrence_definition_id, status")
      .in("recurrence_definition_id", ids)
      .is("deleted_at", null);
    for (const t of occ ?? []) {
      const id = t.recurrence_definition_id;
      if (!id) continue;
      totalByDef.set(id, (totalByDef.get(id) ?? 0) + 1);
      if (t.status === "completed") completedByDef.set(id, (completedByDef.get(id) ?? 0) + 1);
    }
  }

  const definitions: RecurringDefinitionView[] = rows.map((r) => ({
    id: r.id,
    title: r.template_title,
    cadence: cadenceLabel(r.rule_unit as RecurrenceRuleUnit, r.rule_interval),
    ownerName: nameById.get(r.owner_user_id) ?? "Unknown",
    clientName: r.template_client_id ? clientNameById.get(r.template_client_id) ?? "Unknown client" : INTERNAL_CLIENT_LABEL,
    nextOccurrence: r.next_occurrence,
    completedCount: completedByDef.get(r.id) ?? 0,
    totalCount: totalByDef.get(r.id) ?? 0,
  }));

  return { definitions };
}
