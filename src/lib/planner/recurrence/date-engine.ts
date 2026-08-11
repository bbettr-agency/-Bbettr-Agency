/**
 * Pure recurrence date math — NO I/O, NO clock, NO timezone, client-safe.
 *
 * Operates entirely on plain `YYYY-MM-DD` calendar strings (agency-local dates),
 * so there is no UTC/DST drift: an occurrence "slot" is a calendar day, not an
 * instant. This is the crown-jewel module for recurring reminders and is
 * exhaustively unit-tested.
 *
 * MONTHLY NO-DRIFT RULE (locked): stepping keeps the intended day-of-month
 * (`anchorDay`, stored on the definition) and clamps ONLY to the target month's
 * length — never to the previous, already-clamped day. So:
 *   31 Jan → 28/29 Feb → 31 Mar → 30 Apr → 31 May …
 * because each step clamps the anchor (31), not February's clamped 28. Passing the
 * previous slot's day instead of the anchor is exactly the drift bug this avoids,
 * which is why `anchorDay` is REQUIRED for month stepping.
 */
export type RecurrenceUnit = "day" | "week" | "month";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Real length of a 1-based month, leap-year aware. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`);
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

export function formatYmd(year: number, month: number, day: number): string {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Parse + validate a real calendar date. Throws on a malformed or impossible date. */
export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  if (typeof ymd !== "string" || !YMD.test(ymd)) throw new Error(`Invalid date format: ${ymd}`);
  const [year, month, day] = ymd.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${ymd}`);
  if (day < 1 || day > daysInMonth(year, month)) throw new Error(`Invalid day: ${ymd}`);
  return { year, month, day };
}

/** The day-of-month to use as a monthly anchor for a given start date. */
export function anchorDayOf(ymd: string): number {
  return parseYmd(ymd).day;
}

/** Plain-date shift by whole days (UTC-noon math ⇒ no DST/timezone drift). */
export function addDays(ymd: string, days: number): string {
  const { year, month, day } = parseYmd(ymd);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Add whole months to a (year, month) pair, normalising the year. */
function shiftMonth(year: number, month: number, count: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + count;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** min(day, daysInMonth) — clamps a longer anchor into a shorter month. */
export function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/**
 * The next occurrence slot after `slot`, stepping by `interval` units.
 * For "month", `anchorDay` is REQUIRED and drives the no-drift clamp (see header);
 * it is ignored for day/week.
 */
export function nextOccurrence(
  slot: string,
  unit: RecurrenceUnit,
  interval: number,
  anchorDay?: number
): string {
  if (!Number.isInteger(interval) || interval < 1) throw new Error(`interval must be a positive integer: ${interval}`);
  const { year, month } = parseYmd(slot);
  switch (unit) {
    case "day":
      return addDays(slot, interval);
    case "week":
      return addDays(slot, 7 * interval);
    case "month": {
      if (anchorDay == null || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
        throw new Error(`monthly stepping requires an anchorDay in 1..31 (got ${anchorDay})`);
      }
      const target = shiftMonth(year, month, interval);
      return formatYmd(target.year, target.month, clampDay(target.year, target.month, anchorDay));
    }
    default: {
      const _exhaustive: never = unit;
      throw new Error(`Unsupported recurrence unit: ${String(_exhaustive)}`);
    }
  }
}

/**
 * All occurrence slots from `from` (inclusive) while `slot <= until` (inclusive),
 * stepping by the rule. Lexicographic `<=` on YYYY-MM-DD is chronologically
 * correct. `maxCount` is a hard safety cap against pathological windows (interval
 * ≥ 1 already guarantees forward progress).
 */
export function slotsThrough(
  from: string,
  unit: RecurrenceUnit,
  interval: number,
  anchorDay: number | undefined,
  until: string,
  maxCount = 500
): string[] {
  parseYmd(until); // validate bound
  const out: string[] = [];
  let cur = from;
  while (cur <= until && out.length < maxCount) {
    out.push(cur);
    cur = nextOccurrence(cur, unit, interval, anchorDay);
  }
  return out;
}
