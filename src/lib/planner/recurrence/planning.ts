/**
 * Pure recurrence GENERATION PLANNER — NO I/O, NO clock, NO DB. Given a
 * definition's schedule + an agency-local `today` + a look-ahead horizon, it
 * decides exactly which occurrence slots to materialise and what to advance
 * `next_occurrence` to. The DB-backed generator turns this plan into idempotent
 * op calls; keeping the decision pure makes every edge case unit-testable.
 *
 * SCHEDULE-MODE semantics (locked v1): the series is calendar-anchored — the plan
 * never depends on completion. Occurrences are materialised AHEAD of time within
 * the horizon, so a due-but-uncompleted occurrence simply stays overdue as its own
 * task; the next slot is planned independently (missing one never blocks the next).
 *
 * missed_policy:
 *   - 'skip'  → catch-up fast-forwards `next_occurrence` past slots already in the
 *     past (cron offline / stale/back-dated definition) WITHOUT manufacturing a
 *     long overdue backlog. In normal daily operation nothing is ever in the past
 *     (occurrences are created ahead), so skip never triggers.
 *   - 'roll'  → no fast-forward; every slot from next_occurrence up to the horizon
 *     is materialised (a backlog). Not used by v1 (all v1 definitions are 'skip').
 */
import { addDays, anchorDayOf, nextOccurrence, slotsThrough, type RecurrenceUnit } from "./date-engine";

export interface DefinitionSchedule {
  next_occurrence: string; // YYYY-MM-DD — the next un-materialised slot
  rule_unit: RecurrenceUnit;
  rule_interval: number;
  anchor_day: number | null; // required-ish for month (falls back to next_occurrence's day)
  missed_policy: "skip" | "roll";
  due_offset_days: number | null;
}

export interface PlannedOccurrence {
  slot: string; // occurrence_slot (durable key) = the occurrence date
  scheduledDate: string; // === slot in v1
  dueDate: string; // slot + due_offset_days (default 0)
}

export interface GenerationPlan {
  occurrences: PlannedOccurrence[];
  nextOccurrence: string; // value to persist after this pass
  skipped: number; // periods skipped by 'skip' catch-up
}

/** Lexicographic max of two YYYY-MM-DD strings (chronologically correct). */
function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Plan one generation pass for a single definition.
 * @param ensureFirstSlot when true (definition-creation path) the horizon is
 *   stretched so the FIRST occurrence is materialised immediately even if it is
 *   beyond the normal look-ahead window.
 */
export function planGeneration(
  def: DefinitionSchedule,
  today: string,
  horizonDays: number,
  ensureFirstSlot = false
): GenerationPlan {
  const anchor = def.rule_unit === "month" ? def.anchor_day ?? anchorDayOf(def.next_occurrence) : undefined;
  const interval = def.rule_interval;
  const offset = def.due_offset_days ?? 0;

  // 'skip' catch-up: advance past any slot already strictly in the past. Bounded
  // (like slotsThrough) so a years-stale daily definition can never spin — it
  // always terminates anyway since interval ≥ 1 guarantees forward progress.
  let cursor = def.next_occurrence;
  let skipped = 0;
  if (def.missed_policy === "skip") {
    const MAX_CATCHUP = 5000;
    while (cursor < today && skipped < MAX_CATCHUP) {
      cursor = nextOccurrence(cursor, def.rule_unit, interval, anchor);
      skipped++;
    }
  }

  const baseHorizon = addDays(today, horizonDays);
  const horizonEnd = ensureFirstSlot ? maxYmd(baseHorizon, cursor) : baseHorizon;
  const slotDates = slotsThrough(cursor, def.rule_unit, interval, anchor, horizonEnd);

  const occurrences: PlannedOccurrence[] = slotDates.map((slot) => ({
    slot,
    scheduledDate: slot,
    dueDate: addDays(slot, offset),
  }));

  const nextOcc = slotDates.length > 0 ? nextOccurrence(slotDates[slotDates.length - 1], def.rule_unit, interval, anchor) : cursor;

  return { occurrences, nextOccurrence: nextOcc, skipped };
}
