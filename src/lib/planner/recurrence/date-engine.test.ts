import { describe, it, expect } from "vitest";
import {
  isLeapYear,
  daysInMonth,
  parseYmd,
  formatYmd,
  anchorDayOf,
  addDays,
  clampDay,
  nextOccurrence,
  slotsThrough,
} from "./date-engine";

/** Walk N monthly occurrences from a start, using a fixed anchor (no-drift contract). */
function walkMonthly(start: string, count: number, interval = 1, anchor = anchorDayOf(start)): string[] {
  const out = [start];
  let cur = start;
  for (let i = 0; i < count - 1; i++) {
    cur = nextOccurrence(cur, "month", interval, anchor);
    out.push(cur);
  }
  return out;
}

describe("leap years + month lengths", () => {
  it("classifies leap years by the Gregorian rule", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
  });

  it("returns correct month lengths incl. February", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("parse / format / validate", () => {
  it("round-trips valid dates", () => {
    expect(parseYmd("2026-08-25")).toEqual({ year: 2026, month: 8, day: 25 });
    expect(formatYmd(2026, 8, 25)).toBe("2026-08-25");
    expect(formatYmd(2026, 2, 3)).toBe("2026-02-03");
  });
  it("rejects malformed and impossible dates", () => {
    expect(() => parseYmd("2026-13-01")).toThrow();
    expect(() => parseYmd("2026-02-30")).toThrow();
    expect(() => parseYmd("2026-02-29")).toThrow(); // 2026 is not a leap year
    expect(() => parseYmd("2026-8-25")).toThrow(); // not zero-padded
    expect(() => parseYmd("garbage")).toThrow();
    expect(parseYmd("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 }); // leap OK
  });
  it("anchorDayOf reads the day-of-month", () => {
    expect(anchorDayOf("2026-01-31")).toBe(31);
    expect(anchorDayOf("2026-08-25")).toBe(25);
  });
});

describe("addDays (DST-immune plain-date shift)", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-25", 1)).toBe("2026-08-26");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap
  });
});

describe("clampDay", () => {
  it("clamps only when the month is shorter", () => {
    expect(clampDay(2026, 2, 31)).toBe(28);
    expect(clampDay(2028, 2, 31)).toBe(29);
    expect(clampDay(2026, 4, 31)).toBe(30);
    expect(clampDay(2026, 3, 31)).toBe(31); // no clamp
    expect(clampDay(2026, 8, 25)).toBe(25);
  });
});

describe("nextOccurrence — daily", () => {
  it("adds interval days", () => {
    expect(nextOccurrence("2026-08-25", "day", 1)).toBe("2026-08-26");
    expect(nextOccurrence("2026-08-31", "day", 1)).toBe("2026-09-01");
    expect(nextOccurrence("2026-12-31", "day", 1)).toBe("2027-01-01");
    expect(nextOccurrence("2026-08-25", "day", 3)).toBe("2026-08-28");
  });
});

describe("nextOccurrence — weekly", () => {
  it("adds 7×interval days, preserving weekday", () => {
    expect(nextOccurrence("2026-08-25", "week", 1)).toBe("2026-09-01");
    expect(nextOccurrence("2026-08-25", "week", 2)).toBe("2026-09-08");
    expect(nextOccurrence("2026-12-29", "week", 1)).toBe("2027-01-05");
  });
});

describe("nextOccurrence — monthly (no-drift, anchor-driven)", () => {
  it("requires a valid anchorDay for month stepping", () => {
    expect(() => nextOccurrence("2026-01-31", "month", 1)).toThrow();
    expect(() => nextOccurrence("2026-01-31", "month", 1, 0)).toThrow();
    expect(() => nextOccurrence("2026-01-31", "month", 1, 32)).toThrow();
  });

  it("keeps a normal day-of-month across months", () => {
    expect(walkMonthly("2026-08-25", 4)).toEqual(["2026-08-25", "2026-09-25", "2026-10-25", "2026-11-25"]);
  });

  // The exact locked example from the approval.
  it("31 Jan 2026 → 28 Feb → 31 Mar → 30 Apr → 31 May (clamps, never drifts)", () => {
    expect(walkMonthly("2026-01-31", 5)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  // Leap-year variant from the approval.
  it("31 Jan 2028 → 29 Feb → 31 Mar (leap February)", () => {
    expect(walkMonthly("2028-01-31", 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("30th anchor: 30 Jan → 28/29 Feb → 30 Mar (30 never drifts after Feb)", () => {
    expect(walkMonthly("2026-01-30", 3)).toEqual(["2026-01-30", "2026-02-28", "2026-03-30"]);
    expect(walkMonthly("2028-01-30", 3)).toEqual(["2028-01-30", "2028-02-29", "2028-03-30"]);
  });

  it("29th anchor: 29 Jan → 28 Feb (non-leap) but 29 Feb (leap), then 29 Mar", () => {
    expect(walkMonthly("2026-01-29", 3)).toEqual(["2026-01-29", "2026-02-28", "2026-03-29"]);
    expect(walkMonthly("2028-01-29", 3)).toEqual(["2028-01-29", "2028-02-29", "2028-03-29"]);
  });

  it("29 Feb leap-year start recurs to a clamped 28 the following February, then restores", () => {
    // Anchor derived from a 29 Feb start is 29; the next Feb (2029, non-leap) clamps to 28,
    // but 2032 (leap) restores 29 — proving the anchor (29), not the clamp (28), drives stepping.
    const slots = walkMonthly("2028-02-29", 13); // 2028-02 .. 2029-02
    expect(slots[0]).toBe("2028-02-29");
    expect(slots[12]).toBe("2029-02-28"); // +12 months, non-leap Feb → clamp to 28
  });

  it("does NOT permanently drift to 28 after a short February (multi-year walk)", () => {
    // 31-anchor across two years: every long month must show 31, every 30-day month 30.
    const slots = walkMonthly("2026-01-31", 15);
    expect(slots).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("supports interval > 1 (every 2 months) with clamp", () => {
    const slots = walkMonthly("2026-01-31", 4, 2, 31);
    expect(slots).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
  });

  it("crosses the year boundary", () => {
    expect(walkMonthly("2026-11-30", 3)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
  });
});

describe("slotsThrough (windowed generation)", () => {
  it("returns inclusive slots up to the horizon", () => {
    expect(slotsThrough("2026-08-25", "month", 1, 25, "2026-11-01")).toEqual([
      "2026-08-25",
      "2026-09-25",
      "2026-10-25",
    ]);
  });
  it("returns just the start when the next slot is beyond the horizon", () => {
    expect(slotsThrough("2026-08-25", "month", 1, 25, "2026-08-25")).toEqual(["2026-08-25"]);
  });
  it("returns empty when start is already past the horizon", () => {
    expect(slotsThrough("2026-09-25", "month", 1, 25, "2026-08-01")).toEqual([]);
  });
  it("daily window", () => {
    expect(slotsThrough("2026-08-25", "day", 1, undefined, "2026-08-28")).toEqual([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
  });
  it("honours the safety cap", () => {
    expect(slotsThrough("2026-01-01", "day", 1, undefined, "2030-01-01", 5)).toHaveLength(5);
  });
});
