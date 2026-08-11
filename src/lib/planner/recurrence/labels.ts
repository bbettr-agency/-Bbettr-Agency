/** Pure, client-safe recurrence presentation labels. */
import type { RecurrenceUnit } from "./date-engine";

/** Human cadence label, e.g. "Monthly", "Weekly", "Daily", "Every 2 months". */
export function cadenceLabel(unit: RecurrenceUnit, interval: number): string {
  if (interval === 1) {
    return unit === "day" ? "Daily" : unit === "week" ? "Weekly" : "Monthly";
  }
  const noun = unit === "day" ? "days" : unit === "week" ? "weeks" : "months";
  return `Every ${interval} ${noun}`;
}
