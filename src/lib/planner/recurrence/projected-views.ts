/**
 * Pure bridge from recurring DEFINITIONS + already-materialised occurrence slots to
 * presentation-safe PROJECTED `TaskView`s — NO I/O, NO clock, so the merge/dedupe is
 * exhaustively unit-testable. The server-only `projected-read` does the RLS reads and
 * hands the result here. The pure projector (`occurrence-projection`) owns the
 * recurrence math; this module only maps + DEDUPES each projected slot against a real
 * task row by the durable `(recurrence_definition_id, occurrence_slot)` key, so a
 * projected card can never duplicate a materialised one.
 */
import { cadenceLabel } from "./labels";
import { projectDefinitionOccurrences, type ProjectableDefinition } from "./occurrence-projection";
import { projectedOccurrenceToTaskView, type TaskView } from "@/lib/planner/tasks/task-view";
import type { RecurrenceRuleUnit, TaskPriority } from "@/lib/database.types";

/** The columns the projector + presentation builder need from a definition. */
export interface ViewerDefinitionRow {
  id: string;
  template_title: string;
  template_priority: TaskPriority;
  owner_user_id: string;
  default_assignee_id: string | null;
  rule_unit: RecurrenceRuleUnit;
  rule_interval: number;
  anchor_day: number | null;
  next_occurrence: string | null;
  due_offset_days: number | null;
  active: boolean;
}

export interface ViewerProjectionContext {
  defs: ViewerDefinitionRow[];
  /** `${definitionId}:${slot}` for every non-deleted materialised occurrence of these defs. */
  materializedSlots: Set<string>;
}

const slotKey = (definitionId: string, slot: string) => `${definitionId}:${slot}`;

/**
 * Project the viewer's definitions into `TaskView`s visible in `[today, horizonEnd]`
 * (plus bounded overdue recovery), deduped against materialised rows. `today` and
 * `horizonEnd` are agency-local YYYY-MM-DD; `nameById` resolves owner/assignee display
 * names (best-effort, never fabricated).
 */
export function projectViewerOccurrences(
  ctx: ViewerProjectionContext,
  today: string,
  horizonEnd: string,
  nameById: ReadonlyMap<string, string>
): TaskView[] {
  const out: TaskView[] = [];
  for (const d of ctx.defs) {
    const projectable: ProjectableDefinition = {
      id: d.id,
      rule_unit: d.rule_unit,
      rule_interval: d.rule_interval,
      anchor_day: d.anchor_day,
      next_occurrence: d.next_occurrence,
      due_offset_days: d.due_offset_days,
      active: d.active,
    };
    const occurrences = projectDefinitionOccurrences(projectable, today, horizonEnd);
    if (occurrences.length === 0) continue;
    const label = cadenceLabel(d.rule_unit, d.rule_interval);
    for (const occ of occurrences) {
      if (ctx.materializedSlots.has(slotKey(occ.definitionId, occ.slot))) continue; // real row wins
      out.push(
        projectedOccurrenceToTaskView(occ, {
          id: d.id,
          title: d.template_title,
          priority: d.template_priority,
          ownerUserId: d.owner_user_id,
          assigneeId: d.default_assignee_id,
          recurrenceLabel: label,
        }, nameById)
      );
    }
  }
  return out;
}
