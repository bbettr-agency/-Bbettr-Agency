import "server-only";

/**
 * Server-only I/O for recurrence projection: load the viewer's active recurring
 * DEFINITIONS (they OWN or are the default assignee) plus the already-materialised
 * occurrence slots for those definitions, in two RLS-scoped reads (NO service-role).
 * The pure `projected-views` module does the projection + dedupe + presentation, so
 * a projected reminder is visible even when the scheduled materialiser never ran.
 */
import { createClient } from "@/lib/supabase/server";
import type { ViewerDefinitionRow, ViewerProjectionContext } from "./projected-views";

export { projectViewerOccurrences } from "./projected-views";
export type { ViewerProjectionContext } from "./projected-views";

const slotKey = (definitionId: string, slot: string) => `${definitionId}:${slot}`;

/**
 * Load the current admin's active recurring definitions plus the set of already-
 * materialised occurrence slots for those definitions. Returns an empty context on
 * any failure so a projection problem can never blank Today/This Week.
 */
export async function loadViewerProjectionContext(adminId: string): Promise<ViewerProjectionContext> {
  if (!adminId) return { defs: [], materializedSlots: new Set() };
  const supabase = await createClient();

  const { data: defs, error } = await supabase
    .from("recurring_definitions")
    .select("id, template_title, template_priority, owner_user_id, default_assignee_id, rule_unit, rule_interval, anchor_day, next_occurrence, due_offset_days, active")
    .eq("active", true)
    .or(`owner_user_id.eq.${adminId},default_assignee_id.eq.${adminId}`);
  if (error || !defs || defs.length === 0) return { defs: [], materializedSlots: new Set() };

  const ids = defs.map((d) => d.id);
  const { data: occ } = await supabase
    .from("tasks")
    .select("recurrence_definition_id, occurrence_slot")
    .in("recurrence_definition_id", ids)
    .is("deleted_at", null);

  const materializedSlots = new Set<string>();
  for (const t of occ ?? []) {
    if (t.recurrence_definition_id && t.occurrence_slot) materializedSlots.add(slotKey(t.recurrence_definition_id, t.occurrence_slot));
  }
  return { defs: defs as ViewerDefinitionRow[], materializedSlots };
}
