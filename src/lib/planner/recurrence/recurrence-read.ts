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
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
import { listAdminTeam } from "@/lib/planner/team";
import { TaskError } from "@/lib/planner/tasks/errors";
import { cadenceLabel } from "./labels";
import { projectDefinitionOccurrences, nextSlotOnOrAfter, userFacingNext, type ProjectableDefinition } from "./occurrence-projection";
import type { RecurrenceRuleUnit, TaskStatus } from "@/lib/database.types";

const TERMINAL_STATUSES: TaskStatus[] = ["completed", "archived"];

const INTERNAL_CLIENT_LABEL = "Internal / No client";

export interface RecurringDefinitionView {
  id: string;
  title: string;
  cadence: string; // "Monthly", …
  ownerName: string;
  clientName: string; // real name or "Internal / No client"
  /**
   * The user-facing NEXT occurrence — the next date that needs attention, derived
   * from the canonical projector (NOT the internal generator watermark). It is the
   * oldest still-outstanding OVERDUE occurrence when one exists, otherwise the next
   * upcoming occurrence on/after today. Null when nothing is outstanding/upcoming.
   */
  nextOccurrence: string | null;
  /** True when `nextOccurrence` is an outstanding OVERDUE occurrence (needs attention now). */
  nextOverdue: boolean;
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
      .select("id, template_title, template_client_id, owner_user_id, rule_unit, rule_interval, anchor_day, next_occurrence, due_offset_days, active")
      .eq("active", true)
      .order("next_occurrence", { ascending: true }),
    listAdminTeam(profile.workspace_id),
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new TaskError("PersistenceError");

  const rows = defs ?? [];
  const nameById = new Map(team.map((m) => [m.id, m.fullName]));
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const today = todayDate(new Date(), AGENCY_TZ);

  // Occurrence stats + outstanding/materialised slots: one batched read of tasks
  // sharing these definition ids. Slots feed the user-facing "Next" (materialised
  // incomplete occurrences ∪ projected occurrences that are NOT yet materialised).
  const ids = rows.map((r) => r.id);
  const completedByDef = new Map<string, number>();
  const totalByDef = new Map<string, number>();
  const materialisedSlotsByDef = new Map<string, Set<string>>();
  const outstandingSlotsByDef = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: occ } = await supabase
      .from("tasks")
      .select("recurrence_definition_id, occurrence_slot, status")
      .in("recurrence_definition_id", ids)
      .is("deleted_at", null);
    for (const t of occ ?? []) {
      const id = t.recurrence_definition_id;
      if (!id) continue;
      totalByDef.set(id, (totalByDef.get(id) ?? 0) + 1);
      if (t.status === "completed") completedByDef.set(id, (completedByDef.get(id) ?? 0) + 1);
      if (t.occurrence_slot) {
        (materialisedSlotsByDef.get(id) ?? materialisedSlotsByDef.set(id, new Set()).get(id)!).add(t.occurrence_slot);
        if (!TERMINAL_STATUSES.includes(t.status)) {
          (outstandingSlotsByDef.get(id) ?? outstandingSlotsByDef.set(id, []).get(id)!).push(t.occurrence_slot);
        }
      }
    }
  }

  const definitions: RecurringDefinitionView[] = rows.map((r) => {
    const projectable: ProjectableDefinition = {
      id: r.id,
      rule_unit: r.rule_unit as RecurrenceRuleUnit,
      rule_interval: r.rule_interval,
      anchor_day: r.anchor_day,
      next_occurrence: r.next_occurrence,
      due_offset_days: r.due_offset_days,
      active: r.active,
    };
    const materialised = materialisedSlotsByDef.get(r.id) ?? new Set<string>();
    // Outstanding = materialised-incomplete slots ∪ un-materialised projected slots
    // (today + bounded overdue recovery, plus the next upcoming slot). Exclude any
    // projected slot already materialised (in any status) so a completed occurrence
    // never re-counts.
    const projectedToday = projectDefinitionOccurrences(projectable, today, today).map((o) => o.slot);
    const upcoming = nextSlotOnOrAfter(projectable, today);
    const projectedSlots = [...projectedToday, ...(upcoming ? [upcoming] : [])].filter((s) => !materialised.has(s));
    const outstanding = [...(outstandingSlotsByDef.get(r.id) ?? []), ...projectedSlots];
    const next = userFacingNext(outstanding, today);
    return {
      id: r.id,
      title: r.template_title,
      cadence: cadenceLabel(r.rule_unit as RecurrenceRuleUnit, r.rule_interval),
      ownerName: nameById.get(r.owner_user_id) ?? "Unknown",
      clientName: r.template_client_id ? clientNameById.get(r.template_client_id) ?? "Unknown client" : INTERNAL_CLIENT_LABEL,
      nextOccurrence: next?.slot ?? null,
      nextOverdue: next?.overdue ?? false,
      completedCount: completedByDef.get(r.id) ?? 0,
      totalCount: totalByDef.get(r.id) ?? 0,
    };
  });

  return { definitions };
}
