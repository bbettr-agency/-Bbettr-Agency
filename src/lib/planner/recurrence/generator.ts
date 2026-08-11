import "server-only";

/**
 * Server-only recurrence GENERATOR. Turns the pure `planGeneration` decision into
 * idempotent op calls (via the narrow system dispatch) and advances each
 * definition's `next_occurrence`. Runs as service-role (RLS-bypassing) but never
 * trusts a browser: every workspace/owner value comes from the definition rows it
 * reads server-side. It is triggered on a schedule (bearer-protected route) AND
 * on definition creation — NEVER as a side effect of opening a page.
 *
 * Idempotency is guaranteed at two layers: the deterministic (definition, slot)
 * idempotency key + the op's permanent (definition, slot) unique key, so any
 * number of passes converges without duplicates.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
import { addDays } from "./date-engine";
import { planGeneration } from "./planning";
import { generateOccurrence } from "./system-dispatch";
import type { RecurringDefinition } from "@/lib/database.types";

export const RECURRENCE_HORIZON_DAYS = 14;

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DefinitionGenerationResult {
  created: number; // op outcome 'applied'
  existing: number; // 'accepted_noop' | 'replayed'
  skipped: number; // periods skipped by 'skip' catch-up
  advanced: boolean; // next_occurrence moved
  error: boolean;
}

export interface GenerationSummary {
  definitionsProcessed: number;
  occurrencesCreated: number;
  occurrencesExisting: number;
  skipped: number;
  advanced: number;
  errors: number;
}

/** Batched owner display-name snapshots for the event actor (never per-row). */
async function ownerDisplayMap(admin: AdminClient, ownerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
  const map = new Map<string, string>();
  for (const p of data ?? []) map.set(p.id, p.full_name?.trim() || p.email?.trim() || "Admin");
  return map;
}

/**
 * Materialise + advance ONE definition. Shared by the cron pass and the
 * create-on-create path (which passes `ensureFirstSlot` so the first occurrence
 * is created immediately even if it is beyond the normal horizon).
 */
export async function generateForDefinition(
  admin: AdminClient,
  def: RecurringDefinition,
  now: Date,
  opts: { ensureFirstSlot?: boolean; horizonDays?: number; ownerDisplay?: string } = {}
): Promise<DefinitionGenerationResult> {
  const horizonDays = opts.horizonDays ?? RECURRENCE_HORIZON_DAYS;
  const today = todayDate(now, AGENCY_TZ);
  if (def.mode !== "schedule" || !def.active || !def.next_occurrence || !def.workspace_id || !def.owner_user_id) {
    return { created: 0, existing: 0, skipped: 0, advanced: false, error: false };
  }

  const plan = planGeneration(
    {
      next_occurrence: def.next_occurrence,
      rule_unit: def.rule_unit,
      rule_interval: def.rule_interval,
      anchor_day: def.anchor_day,
      missed_policy: def.missed_policy,
      due_offset_days: def.due_offset_days,
    },
    today,
    horizonDays,
    opts.ensureFirstSlot ?? false
  );

  let ownerDisplay = opts.ownerDisplay;
  if (ownerDisplay === undefined) {
    ownerDisplay = (await ownerDisplayMap(admin, [def.owner_user_id])).get(def.owner_user_id) ?? "Admin";
  }

  let created = 0;
  let existing = 0;
  let error = false;
  try {
    for (const occ of plan.occurrences) {
      const res = await generateOccurrence({
        definition: def,
        slot: occ.slot,
        scheduledDate: occ.scheduledDate,
        dueDate: occ.dueDate,
        ownerDisplay,
      });
      if (res.outcome === "applied") created++;
      else existing++; // accepted_noop | replayed → already materialised
    }
    if (plan.nextOccurrence !== def.next_occurrence) {
      const { error: upErr } = await admin
        .from("recurring_definitions")
        .update({ next_occurrence: plan.nextOccurrence })
        .eq("id", def.id)
        .eq("workspace_id", def.workspace_id);
      if (upErr) error = true;
    }
  } catch {
    error = true;
  }

  return { created, existing, skipped: plan.skipped, advanced: plan.nextOccurrence !== def.next_occurrence, error };
}

/**
 * Run the generator for a SINGLE definition by id (used right after recurring
 * creation to advance next_occurrence past the linked first occurrence and fill
 * the look-ahead). Reads the definition server-side; workspace is never trusted
 * from a caller. Safe/idempotent to call repeatedly.
 */
export async function generateForDefinitionId(
  definitionId: string,
  now: Date = new Date()
): Promise<DefinitionGenerationResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("recurring_definitions").select("*").eq("id", definitionId).single();
  if (error || !data) return { created: 0, existing: 0, skipped: 0, advanced: false, error: true };
  return generateForDefinition(admin, data as RecurringDefinition, now);
}

/**
 * One scheduled generation pass across the whole workspace estate. Selects only
 * active, schedule-mode definitions whose next_occurrence is at/inside the horizon
 * (past ones are caught up by 'skip'); anything further out has nothing to do.
 */
export async function generateDueRecurrences(
  now: Date = new Date(),
  horizonDays = RECURRENCE_HORIZON_DAYS
): Promise<GenerationSummary> {
  const admin = createAdminClient();
  const today = todayDate(now, AGENCY_TZ);
  const horizonEnd = addDays(today, horizonDays);

  const summary: GenerationSummary = {
    definitionsProcessed: 0,
    occurrencesCreated: 0,
    occurrencesExisting: 0,
    skipped: 0,
    advanced: 0,
    errors: 0,
  };

  const { data: defs, error } = await admin
    .from("recurring_definitions")
    .select("*")
    .eq("active", true)
    .eq("mode", "schedule")
    .not("next_occurrence", "is", null)
    .lte("next_occurrence", horizonEnd);
  if (error || !defs) {
    summary.errors += 1;
    return summary;
  }

  const displays = await ownerDisplayMap(admin, defs.map((d) => d.owner_user_id));
  for (const def of defs as RecurringDefinition[]) {
    const r = await generateForDefinition(admin, def, now, {
      ownerDisplay: displays.get(def.owner_user_id) ?? "Admin",
      horizonDays,
    });
    summary.definitionsProcessed += 1;
    summary.occurrencesCreated += r.created;
    summary.occurrencesExisting += r.existing;
    summary.skipped += r.skipped;
    if (r.advanced) summary.advanced += 1;
    if (r.error) summary.errors += 1;
  }
  return summary;
}
