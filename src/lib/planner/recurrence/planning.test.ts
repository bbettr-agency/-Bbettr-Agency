import { describe, it, expect } from "vitest";
import { planGeneration, type DefinitionSchedule } from "./planning";

const monthly = (over: Partial<DefinitionSchedule> = {}): DefinitionSchedule => ({
  next_occurrence: "2026-08-25",
  rule_unit: "month",
  rule_interval: 1,
  anchor_day: 25,
  missed_policy: "skip",
  due_offset_days: 0,
  ...over,
});

const slots = (p: { occurrences: { slot: string }[] }) => p.occurrences.map((o) => o.slot);

describe("planGeneration — creation (ensureFirstSlot)", () => {
  it("materialises exactly the first occurrence even when it is beyond the horizon", () => {
    // created 1 Aug, first date 25 Aug (24 days out > 14-day horizon)
    const plan = planGeneration(monthly({ next_occurrence: "2026-08-25" }), "2026-08-01", 14, true);
    expect(slots(plan)).toEqual(["2026-08-25"]);
    expect(plan.nextOccurrence).toBe("2026-09-25");
    expect(plan.skipped).toBe(0);
  });

  it("first occurrence today materialises just today, advances to next month", () => {
    const plan = planGeneration(monthly({ next_occurrence: "2026-08-25" }), "2026-08-25", 14, true);
    expect(slots(plan)).toEqual(["2026-08-25"]);
    expect(plan.nextOccurrence).toBe("2026-09-25");
  });
});

describe("planGeneration — 14-day look-ahead (cron)", () => {
  it("does nothing until the occurrence enters the horizon", () => {
    // next 25 Sep, today 5 Sep → horizon 19 Sep < 25 Sep
    const plan = planGeneration(monthly({ next_occurrence: "2026-09-25" }), "2026-09-05", 14, false);
    expect(slots(plan)).toEqual([]);
    expect(plan.nextOccurrence).toBe("2026-09-25"); // unchanged
  });

  it("materialises the occurrence once it is within 14 days, advancing next_occurrence", () => {
    // today 11 Sep → horizon 25 Sep includes 25 Sep
    const plan = planGeneration(monthly({ next_occurrence: "2026-09-25" }), "2026-09-11", 14, false);
    expect(slots(plan)).toEqual(["2026-09-25"]);
    expect(plan.nextOccurrence).toBe("2026-10-25");
  });
});

describe("planGeneration — idempotent advancement across runs", () => {
  it("a re-run after advancement plans no duplicate slot", () => {
    const first = planGeneration(monthly({ next_occurrence: "2026-09-25" }), "2026-09-11", 14, false);
    expect(slots(first)).toEqual(["2026-09-25"]);
    // persist advancement, run again same day
    const second = planGeneration(monthly({ next_occurrence: first.nextOccurrence }), "2026-09-11", 14, false);
    expect(slots(second)).toEqual([]); // 25 Oct is beyond 25 Sep horizon
    expect(second.nextOccurrence).toBe("2026-10-25");
  });
});

describe("planGeneration — missed 'skip' catch-up (stale / cron offline)", () => {
  it("does NOT manufacture a backlog: fast-forwards to the next upcoming slot", () => {
    // next_occurrence stale at 25 May; today 20 Sep (cron offline for months).
    // horizon → 4 Oct includes the upcoming 25 Sep; May/Jun/Jul/Aug are skipped, not created.
    const plan = planGeneration(monthly({ next_occurrence: "2026-05-25" }), "2026-09-20", 14, false);
    expect(slots(plan)).toEqual(["2026-09-25"]);
    expect(plan.skipped).toBe(4);
    expect(plan.nextOccurrence).toBe("2026-10-25");
  });

  it("fast-forwards past missed months, materialises only the in-horizon upcoming one", () => {
    // stale 25 May, today 15 Sep → skip May/Jun/Jul/Aug; 25 Sep within horizon (29 Sep)
    const plan = planGeneration(monthly({ next_occurrence: "2026-05-25" }), "2026-09-15", 14, false);
    expect(slots(plan)).toEqual(["2026-09-25"]);
    expect(plan.skipped).toBe(4); // May,Jun,Jul,Aug skipped → cursor Sep
    expect(plan.nextOccurrence).toBe("2026-10-25");
  });

  it("skip does not fire in normal operation (next_occurrence never in the past)", () => {
    const plan = planGeneration(monthly({ next_occurrence: "2026-09-25" }), "2026-09-11", 14, false);
    expect(plan.skipped).toBe(0);
  });

  it("skip catch-up is bounded (a years-stale daily definition cannot spin unbounded)", () => {
    const plan = planGeneration(
      { next_occurrence: "2000-01-01", rule_unit: "day", rule_interval: 1, anchor_day: null, missed_policy: "skip", due_offset_days: 0 },
      "2026-08-25",
      14,
      false
    );
    // Terminates via the MAX_CATCHUP guard; no unbounded loop, deterministic result.
    expect(plan.skipped).toBeLessThanOrEqual(5000);
    expect(Array.isArray(plan.occurrences)).toBe(true);
  });
});

describe("planGeneration — 'roll' backfills (not used in v1, but defined)", () => {
  it("materialises every missed slot up to the horizon", () => {
    const plan = planGeneration(
      monthly({ next_occurrence: "2026-06-25", missed_policy: "roll" }),
      "2026-09-11",
      14,
      false
    );
    expect(slots(plan)).toEqual(["2026-06-25", "2026-07-25", "2026-08-25", "2026-09-25"]);
    expect(plan.skipped).toBe(0);
    expect(plan.nextOccurrence).toBe("2026-10-25");
  });
});

describe("planGeneration — daily / weekly", () => {
  it("daily fills the whole horizon window on create", () => {
    const plan = planGeneration(
      { next_occurrence: "2026-08-25", rule_unit: "day", rule_interval: 1, anchor_day: null, missed_policy: "skip", due_offset_days: 0 },
      "2026-08-25",
      3,
      true
    );
    expect(slots(plan)).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(plan.nextOccurrence).toBe("2026-08-29");
  });

  it("weekly steps by 7 days", () => {
    const plan = planGeneration(
      { next_occurrence: "2026-08-25", rule_unit: "week", rule_interval: 1, anchor_day: null, missed_policy: "skip", due_offset_days: 0 },
      "2026-08-25",
      14,
      false
    );
    // horizon 25 Aug + 14 = 8 Sep (inclusive) → three weekly slots
    expect(slots(plan)).toEqual(["2026-08-25", "2026-09-01", "2026-09-08"]);
    expect(plan.nextOccurrence).toBe("2026-09-15");
  });
});

describe("planGeneration — due_offset_days", () => {
  it("default 0 → dueDate === slot", () => {
    const plan = planGeneration(monthly({ next_occurrence: "2026-08-25" }), "2026-08-25", 14, true);
    expect(plan.occurrences[0]).toEqual({ slot: "2026-08-25", scheduledDate: "2026-08-25", dueDate: "2026-08-25" });
  });
  it("positive offset shifts only dueDate", () => {
    const plan = planGeneration(monthly({ next_occurrence: "2026-08-25", due_offset_days: 3 }), "2026-08-25", 14, true);
    expect(plan.occurrences[0]).toEqual({ slot: "2026-08-25", scheduledDate: "2026-08-25", dueDate: "2026-08-28" });
  });
});

describe("planGeneration — monthly no-drift within a generation window", () => {
  it("31-anchor across a short February stays 31 in March", () => {
    // roll to force a multi-slot window that crosses February
    const plan = planGeneration(
      { next_occurrence: "2026-01-31", rule_unit: "month", rule_interval: 1, anchor_day: 31, missed_policy: "roll", due_offset_days: 0 },
      "2026-03-31",
      1,
      false
    );
    expect(slots(plan)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});
