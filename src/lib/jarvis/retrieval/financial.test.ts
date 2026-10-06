import { describe, it, expect } from "vitest";
import { summarizeUnpaid } from "./financial";

describe("summarizeUnpaid — exact vs partial lower-bound semantics", () => {
  it("COMPLETE: all unpaid rows summed in one currency → exact", () => {
    const s = summarizeUnpaid(
      [
        { amount: 10000, currency: "ZAR" },
        { amount: 20000, currency: "ZAR" },
        { amount: 5000, currency: "ZAR" },
      ],
      3
    );
    expect(s.exact).toBe(true);
    expect(s.basis).toBe("exact");
    expect(s.amountRetrieved).toBe(35000);
    expect(s.unpaidCount).toBe(3);
    expect(s.rowsCounted).toBe(3);
  });

  it("TRUNCATED: fewer rows summed than exist → partial / lower bound", () => {
    const s = summarizeUnpaid(
      [
        { amount: 10000, currency: "ZAR" },
        { amount: 12000, currency: "ZAR" },
        { amount: 8000, currency: "ZAR" },
        { amount: 0, currency: "ZAR" },
        { amount: 0, currency: "ZAR" },
      ],
      8 // 8 exist, 5 summed
    );
    expect(s.exact).toBe(false);
    expect(s.basis).toBe("lower_bound");
    expect(s.unpaidCount).toBe(8);
    expect(s.rowsCounted).toBe(5);
    expect(s.amountRetrieved).toBe(30000);
  });

  it("mixed currencies → not exact even if all rows summed", () => {
    const s = summarizeUnpaid(
      [
        { amount: 100, currency: "ZAR" },
        { amount: 200, currency: "USD" },
      ],
      2
    );
    expect(s.exact).toBe(false);
    expect(s.currency).toBe("mixed");
  });

  it("no unpaid invoices → zero, exact", () => {
    const s = summarizeUnpaid([], 0);
    expect(s.unpaidCount).toBe(0);
    expect(s.exact).toBe(true);
  });
});
