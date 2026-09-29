/**
 * Pure recurrence OCCURRENCE PROJECTOR — NO I/O, NO clock, NO DB, client-safe.
 *
 * This is the single canonical interpretation of "which occurrences of a recurring
 * reminder should a human SEE right now", shared by Today, This Week and the
 * Recurring Reminders management view. It does NOT depend on the scheduled
 * materialiser having run: visibility is derived directly from the definition's
 * schedule via the crown-jewel `date-engine`, so a legitimately-due occurrence is
 * surfaced even when no task row was pre-created.
 *
 * KEY INVARIANT the projection relies on: the materialiser creates every slot from
 * the series start THROUGH the last generated slot and parks `next_occurrence` at
 * the FIRST un-materialised slot. Therefore **every slot `< next_occurrence` is
 * already a materialised task row**, and the ONLY slots that can be missing are
 * `>= next_occurrence`. The projector enumerates forward from `next_occurrence`
 * and the read layer DEDUPES every projected slot against the real materialised
 * rows by `(recurrence_definition_id, occurrence_slot)` — so a projected card can
 * never duplicate a materialised one, and materialised rows stay authoritative for
 * lifecycle/history/completion.
 *
 * NO MASS BACKFILL (locked): future/current occurrences inside the caller's window
 * are surfaced in full, but PAST-and-still-un-materialised occurrences are
 * collapsed to a SINGLE most-recent one (bounded by a recovery look-back), so a
 * daily reminder whose generation was broken for weeks yields at most ONE overdue
 * projected card — never a pile — while a genuinely due invoice never silently
 * disappears.
 */
import { addDays, anchorDayOf, nextOccurrence, slotsThrough, type RecurrenceUnit } from "./date-engine";

/**
 * How far back a still-un-materialised, still-outstanding occurrence may be and
 * still be surfaced as overdue. Long enough that a monthly invoice missed last
 * month is recovered; the single-most-recent collapse (below) is what actually
 * caps the volume, so this only bounds staleness, never count.
 */
export const RECURRENCE_RECOVERY_LOOKBACK_DAYS = 45;

/** Hard safety cap on grid stepping (mirrors date-engine/planning bounds). */
const MAX_STEPS = 5000;

/** The minimal definition shape the projector needs (all agency-local calendar data). */
export interface ProjectableDefinition {
  id: string;
  rule_unit: RecurrenceUnit;
  rule_interval: number;
  anchor_day: number | null;
  /** The generator watermark = the first UN-materialised slot (lower bound of projection). */
  next_occurrence: string | null;
  due_offset_days: number | null;
  active: boolean;
}

export interface ProjectedOccurrence {
  definitionId: string;
  slot: string; // occurrence_slot (durable identity with recurrence_definition_id)
  scheduledDate: string; // === slot
  dueDate: string; // slot + due_offset_days
  /** True when this projected occurrence's due date is strictly before `today`. */
  isOverdue: boolean;
}

function monthlyAnchor(def: ProjectableDefinition): number | undefined {
  if (def.rule_unit !== "month") return undefined;
  return def.anchor_day ?? anchorDayOf(def.next_occurrence as string);
}

/**
 * The earliest grid slot `>= floor`, stepping the rule forward from `reference`.
 * `reference` (the watermark) is always on-grid, so this snaps enumeration to the
 * recovery window without O(stale-days) work for a long-broken series. Bounded.
 */
function alignedStart(
  reference: string,
  unit: RecurrenceUnit,
  interval: number,
  anchor: number | undefined,
  floor: string
): string {
  let cur = reference;
  let guard = 0;
  while (cur < floor && guard < MAX_STEPS) {
    cur = nextOccurrence(cur, unit, interval, anchor);
    guard++;
  }
  return cur;
}

/**
 * Project the occurrences of ONE active definition that a human should SEE, given
 * the agency-local `today` and an inclusive visibility horizon `horizonEnd`
 * (`today` for Today, the week's Sunday for This Week). Returns, deduped and
 * ordered by slot:
 *   - EVERY occurrence in `[today, horizonEnd]` (current/future in-window), and
 *   - AT MOST ONE overdue occurrence: the most recent slot `< today` that is still
 *     within `RECURRENCE_RECOVERY_LOOKBACK_DAYS` (collapsed anti-pile recovery).
 *
 * Only slots `>= next_occurrence` are ever produced (everything earlier is already
 * materialised), so the caller's `(definitionId, slot)` dedupe against real rows is
 * sufficient to guarantee no duplicate cards.
 */
export function projectDefinitionOccurrences(
  def: ProjectableDefinition,
  today: string,
  horizonEnd: string,
  lookbackDays: number = RECURRENCE_RECOVERY_LOOKBACK_DAYS
): ProjectedOccurrence[] {
  if (!def.active || !def.next_occurrence) return [];
  const unit = def.rule_unit;
  const interval = def.rule_interval;
  const anchor = monthlyAnchor(def);
  const offset = def.due_offset_days ?? 0;

  const recoveryFloor = addDays(today, -Math.max(0, lookbackDays));
  // Never enumerate below the watermark (everything earlier is materialised) and
  // never below the recovery floor (bounds a long-broken series to O(window)).
  const floor = def.next_occurrence > recoveryFloor ? def.next_occurrence : recoveryFloor;
  const start = alignedStart(def.next_occurrence, unit, interval, anchor, floor);

  // Upper bound: the visibility horizon, but at least `today` so a single overdue
  // slot in [floor, today) is still enumerated when horizonEnd === today.
  const upper = horizonEnd >= today ? horizonEnd : today;
  const slots = slotsThrough(start, unit, interval, anchor, upper);

  const current: ProjectedOccurrence[] = [];
  let mostRecentOverdue: ProjectedOccurrence | null = null;
  for (const slot of slots) {
    const dueDate = addDays(slot, offset);
    if (slot >= today && slot <= horizonEnd) {
      current.push({ definitionId: def.id, slot, scheduledDate: slot, dueDate, isOverdue: dueDate < today });
    } else if (slot < today) {
      // Keep only the newest past slot (list is ascending ⇒ last one wins).
      mostRecentOverdue = { definitionId: def.id, slot, scheduledDate: slot, dueDate, isOverdue: dueDate < today };
    }
  }

  const out: ProjectedOccurrence[] = [];
  if (mostRecentOverdue && mostRecentOverdue.isOverdue) out.push(mostRecentOverdue);
  out.push(...current);
  return out;
}

/**
 * The user-facing "Next" for a definition: the earliest occurrence that still needs
 * attention. `outstandingSlots` are the definition's un-completed occurrence slots
 * (materialised incomplete rows ∪ the projected set), agency-local YYYY-MM-DD.
 * Returns the oldest OUTSTANDING OVERDUE slot when one exists (overdue is what needs
 * attention first), otherwise the earliest upcoming slot `>= today`; null when the
 * series has nothing outstanding/upcoming in view.
 */
/**
 * The earliest UN-materialised occurrence slot `>= today` for a definition (its next
 * upcoming slot from the schedule), or null when inactive/no watermark. Bounded grid
 * stepping from the watermark; used to compute the user-facing "Next" for a series
 * whose next occurrence is beyond the pre-materialised horizon (e.g. next month).
 */
export function nextSlotOnOrAfter(def: ProjectableDefinition, today: string): string | null {
  if (!def.active || !def.next_occurrence) return null;
  const anchor = monthlyAnchor(def);
  const floor = def.next_occurrence > today ? def.next_occurrence : today;
  return alignedStart(def.next_occurrence, def.rule_unit, def.rule_interval, anchor, floor);
}

export function userFacingNext(
  outstandingSlots: readonly string[],
  today: string
): { slot: string; overdue: boolean } | null {
  let oldestOverdue: string | null = null;
  let earliestUpcoming: string | null = null;
  for (const s of outstandingSlots) {
    if (s < today) {
      if (oldestOverdue === null || s < oldestOverdue) oldestOverdue = s;
    } else if (earliestUpcoming === null || s < earliestUpcoming) {
      earliestUpcoming = s;
    }
  }
  if (oldestOverdue !== null) return { slot: oldestOverdue, overdue: true };
  if (earliestUpcoming !== null) return { slot: earliestUpcoming, overdue: false };
  return null;
}
