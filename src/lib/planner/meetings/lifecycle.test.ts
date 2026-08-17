import { describe, it, expect } from "vitest";
import { deriveMeetingState, type LifecycleFields } from "./lifecycle";

const NOW = new Date("2026-08-17T12:00:00Z");
const FUTURE = "2026-08-17T13:00:00Z";
const PAST = "2026-08-17T11:00:00Z";

const base = (over: Partial<LifecycleFields> = {}): LifecycleFields => ({
  status: "scheduled",
  no_show_at: null,
  attended_at: null,
  ends_at: FUTURE,
  ...over,
});

describe("deriveMeetingState", () => {
  it("upcoming: scheduled, no outcome, ends in the future", () => {
    expect(deriveMeetingState(base({ ends_at: FUTURE }), NOW)).toBe("upcoming");
  });

  it("needs_outcome: scheduled, no outcome, ended in the past", () => {
    expect(deriveMeetingState(base({ ends_at: PAST }), NOW)).toBe("needs_outcome");
  });

  it("completed: attended_at set", () => {
    expect(deriveMeetingState(base({ ends_at: PAST, attended_at: PAST }), NOW)).toBe("completed");
  });

  it("no_show: no_show_at set", () => {
    expect(deriveMeetingState(base({ ends_at: PAST, no_show_at: PAST }), NOW)).toBe("no_show");
  });

  it("cancelled: status cancelled", () => {
    expect(deriveMeetingState(base({ status: "cancelled" }), NOW)).toBe("cancelled");
  });

  it("ends_at === now() resolves to needs_outcome (boundary is inclusive of 'over')", () => {
    expect(deriveMeetingState(base({ ends_at: NOW.toISOString() }), NOW)).toBe("needs_outcome");
  });

  describe("precedence: cancelled → no_show → completed → needs_outcome → upcoming", () => {
    it("cancelled beats everything (even attended/no-show set)", () => {
      expect(deriveMeetingState({ status: "cancelled", no_show_at: PAST, attended_at: null, ends_at: PAST }, NOW)).toBe("cancelled");
      expect(deriveMeetingState({ status: "cancelled", no_show_at: null, attended_at: PAST, ends_at: PAST }, NOW)).toBe("cancelled");
    });
    it("no_show beats completed/needs_outcome when scheduled", () => {
      // (attended+no_show can't coexist per DB CHECK, but precedence is defined regardless)
      expect(deriveMeetingState({ status: "scheduled", no_show_at: PAST, attended_at: null, ends_at: PAST }, NOW)).toBe("no_show");
    });
    it("completed beats needs_outcome", () => {
      expect(deriveMeetingState(base({ ends_at: PAST, attended_at: PAST }), NOW)).toBe("completed");
    });
  });

  it("is timezone/DST-independent (pure instant comparison)", () => {
    // Same instant expressed with different offsets → identical classification.
    const nowNy = new Date("2026-08-17T08:00:00-04:00"); // == 12:00Z
    expect(deriveMeetingState(base({ ends_at: "2026-08-17T09:00:00-04:00" /* 13:00Z */ }), nowNy)).toBe("upcoming");
    expect(deriveMeetingState(base({ ends_at: "2026-08-17T07:00:00-04:00" /* 11:00Z */ }), nowNy)).toBe("needs_outcome");
  });
});
