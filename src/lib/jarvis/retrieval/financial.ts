/**
 * Jarvis Retrieval V2 — bounded financial aggregate semantics (PURE, no I/O).
 *
 * The no-migration approach sums unpaid-invoice amounts from a BOUNDED sample of
 * rows. If the number of unpaid invoices exceeds the rows we summed, the amount is
 * a PARTIAL LOWER BOUND and MUST NOT be presented as the client's exact total
 * outstanding. This module computes those semantics; the serializer renders them so
 * the provider cannot turn a partial sum into "Total outstanding is R30,000".
 */

export interface FinancialSummary {
  /** Total number of unpaid invoices (exact count). */
  unpaidCount: number;
  /** How many rows were actually summed for the amount. */
  rowsCounted: number;
  /** Sum of the amounts of the summed rows. */
  amountRetrieved: number;
  currency: string | "mixed" | null;
  /** True only when EVERY unpaid invoice was summed in a single currency. */
  exact: boolean;
  basis: "exact" | "lower_bound";
}

export function summarizeUnpaid(
  rows: Array<{ amount: number; currency: string }>,
  totalUnpaidCount: number
): FinancialSummary {
  const amountRetrieved = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const currencies = new Set(rows.map((r) => r.currency));
  const currency = rows.length === 0 ? null : currencies.size === 1 ? [...currencies][0] : "mixed";
  const exact = totalUnpaidCount <= rows.length && currency !== "mixed";
  return {
    unpaidCount: totalUnpaidCount,
    rowsCounted: rows.length,
    amountRetrieved,
    currency,
    exact,
    basis: exact ? "exact" : "lower_bound",
  };
}
