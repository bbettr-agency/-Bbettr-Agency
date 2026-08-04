import { describe, it, expect } from "vitest";
import { isValidCalendarDate, agencyToday, isTodayOrFuture, isValidScheduleDate } from "./schedule-date";

describe("schedule-date — isValidCalendarDate", () => {
  it("accepts a real YYYY-MM-DD day", () => {
    expect(isValidCalendarDate("2026-08-04")).toBe(true);
    expect(isValidCalendarDate("2026-02-28")).toBe(true);
    expect(isValidCalendarDate("2028-02-29")).toBe(true); // leap day
  });
  it("rejects malformed / impossible / non-string values", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-8-1", "08/10/2026", "2026-00-10", "2026-01-32", "", "notadate", 20260804, null, undefined]) {
      expect(isValidCalendarDate(bad as unknown)).toBe(false);
    }
  });
});

describe("schedule-date — agencyToday (Africa/Johannesburg, UTC+2)", () => {
  it("maps a UTC instant to the correct agency-local day", () => {
    // 23:30 UTC on Aug 3 is 01:30 on Aug 4 in Johannesburg.
    expect(agencyToday(new Date("2026-08-03T23:30:00.000Z"))).toBe("2026-08-04");
    // 21:00 UTC on Aug 3 is 23:00 on Aug 3 in Johannesburg.
    expect(agencyToday(new Date("2026-08-03T21:00:00.000Z"))).toBe("2026-08-03");
  });
  it("is deterministic for a fixed now", () => {
    const n = new Date("2026-08-04T09:00:00.000Z");
    expect(agencyToday(n)).toBe(agencyToday(n));
  });
});

describe("schedule-date — isTodayOrFuture", () => {
  const today = "2026-08-04";
  it("today is allowed", () => expect(isTodayOrFuture(today, today)).toBe(true));
  it("future is allowed", () => expect(isTodayOrFuture("2026-08-05", today)).toBe(true));
  it("past is rejected", () => {
    expect(isTodayOrFuture("2026-08-03", today)).toBe(false);
    expect(isTodayOrFuture("2025-12-31", today)).toBe(false);
  });
});

describe("schedule-date — isValidScheduleDate (the full rule)", () => {
  const today = "2026-08-04";
  it("accepts today and future real days", () => {
    expect(isValidScheduleDate("2026-08-04", today)).toBe(true);
    expect(isValidScheduleDate("2026-12-31", today)).toBe(true);
  });
  it("rejects past real days", () => {
    expect(isValidScheduleDate("2026-08-03", today)).toBe(false);
  });
  it("rejects malformed / impossible / non-string even if 'future-looking'", () => {
    expect(isValidScheduleDate("2026-13-01", today)).toBe(false);
    expect(isValidScheduleDate("2026-02-30", today)).toBe(false);
    expect(isValidScheduleDate("2026-8-5", today)).toBe(false);
    expect(isValidScheduleDate("", today)).toBe(false);
    expect(isValidScheduleDate(20261231 as unknown, today)).toBe(false);
  });
});
