import { describe, it, expect } from "vitest";
import {
  localDate,
  todayDate,
  weekRange,
  meetingsOnDate,
  meetingsInRange,
  upcomingMeetings,
} from "./date-views";
import type { Meeting } from "@/lib/database.types";

function meeting(id: string, startsAt: string): Meeting {
  return {
    id,
    title: id,
    description: null,
    starts_at: startsAt,
    ends_at: startsAt,
    time_zone: "UTC",
    has_meet: false,
    status: "scheduled",
    idempotency_key: null,
    created_by: "x",
    created_at: startsAt,
    updated_at: startsAt,
    cancelled_by: null,
    cancelled_at: null,
    deleted_at: null,
    no_show_at: null,
    no_show_followup_sent_at: null,
    reschedule_token_hash: null,
    reschedule_token_expires_at: null,
  };
}

describe("localDate / todayDate", () => {
  it("returns the calendar date in the given zone", () => {
    // 23:30 UTC on the 5th is already the 6th in Johannesburg (UTC+2).
    expect(localDate("2026-08-05T23:30:00Z", "Africa/Johannesburg")).toBe("2026-08-06");
    expect(localDate("2026-08-05T23:30:00Z", "UTC")).toBe("2026-08-05");
    expect(todayDate(new Date("2026-08-05T12:00:00Z"), "UTC")).toBe("2026-08-05");
  });
});

describe("weekRange", () => {
  it("returns Monday–Sunday of the containing week", () => {
    const { start, end } = weekRange(new Date("2026-08-05T12:00:00Z"), "UTC");
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    expect(s.getUTCDay()).toBe(1); // Monday
    expect(e.getUTCDay()).toBe(0); // Sunday
    expect((e.getTime() - s.getTime()) / 86_400_000).toBe(6);
    const today = todayDate(new Date("2026-08-05T12:00:00Z"), "UTC");
    expect(start <= today && today <= end).toBe(true);
  });
});

describe("meeting filters", () => {
  const now = new Date("2026-08-05T12:00:00Z"); // Wednesday (UTC)
  const ms = [
    meeting("mon", "2026-08-03T09:00:00Z"),
    meeting("wed", "2026-08-05T09:00:00Z"),
    meeting("sun", "2026-08-09T09:00:00Z"),
    meeting("next", "2026-08-12T09:00:00Z"),
    meeting("past", "2026-07-30T09:00:00Z"),
  ];

  it("meetingsOnDate picks a single agency-local day", () => {
    expect(meetingsOnDate(ms, "2026-08-05", "UTC").map((m) => m.id)).toEqual(["wed"]);
  });

  it("meetingsInRange is inclusive of both ends", () => {
    const { start, end } = weekRange(now, "UTC"); // 08-03 .. 08-09
    expect(meetingsInRange(ms, start, end, "UTC").map((m) => m.id)).toEqual([
      "mon",
      "wed",
      "sun",
    ]);
  });

  it("upcomingMeetings drops past days (today onward)", () => {
    expect(upcomingMeetings(ms, now, "UTC").map((m) => m.id)).toEqual([
      "wed",
      "sun",
      "next",
    ]);
  });
});
