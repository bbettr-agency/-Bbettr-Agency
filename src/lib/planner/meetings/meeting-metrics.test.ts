import { describe, it, expect } from "vitest";
import type { Meeting } from "@/lib/database.types";
import type { SafeProjectionView } from "./view-types";
import {
  scheduledMeetings,
  durationMinutes,
  meetingsTodayCount,
  meetingsThisWeekCount,
  nextMeeting,
  syncHealth,
  overlapCountOnDay,
  busiestDay,
  ownerMeetingCounts,
  busiestOwner,
  timelineDays,
  bucketTodayMeetings,
  startsWithinMinutes,
  minutesUntil,
  upcomingWeekDays,
  capDays,
} from "./meeting-metrics";
import {
  formatDayLabel,
  formatTimeInZone,
  formatUpcomingDayParts,
  formatCountdown,
} from "./date-views";

const NOW = new Date("2026-08-05T12:00:00Z"); // Wednesday, 12:00 UTC
const TZ = "UTC";

function mtg(
  id: string,
  starts: string,
  ends: string,
  opts: { status?: "scheduled" | "cancelled"; owner?: string } = {}
): Meeting {
  return {
    id,
    title: id,
    description: null,
    starts_at: starts,
    ends_at: ends,
    time_zone: "UTC",
    has_meet: false,
    status: opts.status ?? "scheduled",
    idempotency_key: null,
    created_by: opts.owner ?? "A",
    created_at: starts,
    updated_at: starts,
    cancelled_by: null,
    cancelled_at: null,
    deleted_at: null,
    no_show_at: null,
    no_show_followup_sent_at: null,
    reschedule_token_hash: null,
    reschedule_token_expires_at: null,
    attended_at: null,
    outcome_notes: null,
    thank_you_sent_at: null,
  };
}

// Current week (UTC): Mon 2026-08-03 … Sun 2026-08-09.
const M = {
  todayPast: mtg("todayPast", "2026-08-05T09:00:00Z", "2026-08-05T10:00:00Z", { owner: "A" }),
  todayNext: mtg("todayNext", "2026-08-05T14:00:00Z", "2026-08-05T15:00:00Z", { owner: "A" }),
  todayOverlap: mtg("todayOverlap", "2026-08-05T14:30:00Z", "2026-08-05T15:30:00Z", { owner: "A" }),
  todayCancelled: mtg("todayCancelled", "2026-08-05T13:00:00Z", "2026-08-05T13:30:00Z", { status: "cancelled" }),
  tomorrow: mtg("tomorrow", "2026-08-06T10:00:00Z", "2026-08-06T11:00:00Z", { owner: "B" }),
  friday: mtg("friday", "2026-08-07T15:30:00Z", "2026-08-07T16:30:00Z", { owner: "A" }),
  nextWeek: mtg("nextWeek", "2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z"),
  lastWeek: mtg("lastWeek", "2026-07-30T09:00:00Z", "2026-07-30T10:00:00Z"),
};
const ALL = Object.values(M);

describe("counts (cancelled excluded, agency-local day)", () => {
  it("counts today's scheduled meetings only", () => {
    // todayPast, todayNext, todayOverlap = 3 scheduled; cancelled excluded.
    expect(meetingsTodayCount(ALL, NOW, TZ)).toBe(3);
  });
  it("counts the current week's scheduled meetings only", () => {
    // today(3) + tomorrow(1) + friday(1) = 5; cancelled, last/next week excluded.
    expect(meetingsThisWeekCount(ALL, NOW, TZ)).toBe(5);
  });
  it("scheduledMeetings drops cancelled rows", () => {
    expect(scheduledMeetings(ALL).some((m) => m.id === "todayCancelled")).toBe(false);
  });
});

describe("nextMeeting", () => {
  it("returns the soonest meeting that has not started; never a past one", () => {
    expect(nextMeeting(ALL, NOW)?.id).toBe("todayNext");
  });
  it("skips a cancelled meeting even if it is chronologically sooner", () => {
    const cancelledSooner = mtg("cx", "2026-08-05T13:00:00Z", "2026-08-05T13:30:00Z", { status: "cancelled" });
    expect(nextMeeting([cancelledSooner, ...ALL], NOW)?.id).toBe("todayNext");
  });
  it("is null when nothing is upcoming", () => {
    expect(nextMeeting([M.todayPast, M.lastWeek], NOW)).toBeNull();
  });
});

describe("overlapCountOnDay", () => {
  it("counts overlapping scheduled pairs on a day", () => {
    // todayNext(14–15) overlaps todayOverlap(14:30–15:30) → 1 pair; 9–10 no overlap.
    expect(overlapCountOnDay(ALL, "2026-08-05", TZ)).toBe(1);
  });
  it("is 0 on a day with no overlaps", () => {
    expect(overlapCountOnDay(ALL, "2026-08-06", TZ)).toBe(0);
  });
});

describe("busiestDay / owner counts", () => {
  it("finds the day with the most scheduled meetings", () => {
    expect(busiestDay(ALL, NOW, TZ)).toEqual({ date: "2026-08-05", count: 3 });
  });
  it("counts scheduled meetings per owner within the week", () => {
    const counts = ownerMeetingCounts(ALL, { from: "2026-08-03", to: "2026-08-09", tz: TZ });
    expect(counts.get("A")).toBe(4); // todayPast, todayNext, todayOverlap, friday
    expect(counts.get("B")).toBe(1); // tomorrow
  });
  it("finds the busiest owner this week", () => {
    expect(busiestOwner(ALL, NOW, TZ)).toEqual({ ownerId: "A", count: 4 });
  });
});

describe("syncHealth rollup", () => {
  const view = (entityId: string, syncState: SafeProjectionView["syncState"]): SafeProjectionView => ({
    entityId, syncState, meetState: "not_requested", meetUrl: null, lastSyncAt: null,
  });
  it("counts failed (incl. disconnected) and pending; healthy when neither", () => {
    const h = syncHealth([
      view("1", "synced"), view("2", "synced"),
      view("3", "failed"), view("4", "pending"), view("5", "disconnected"),
    ]);
    expect(h).toEqual({ failed: 2, pending: 1, synced: 2, total: 5, healthy: false });
  });
  it("is healthy when empty or all synced", () => {
    expect(syncHealth([]).healthy).toBe(true);
    expect(syncHealth([view("1", "synced")]).healthy).toBe(true);
  });
});

describe("timelineDays (grouping by agency-local day)", () => {
  it("groups today→end-of-week, includes cancelled (muted), excludes out-of-range", () => {
    const days = timelineDays(ALL, NOW, TZ);
    expect(days.map((d) => d.date)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
    // Today includes the cancelled meeting (4 total) — totals exclude it, the timeline shows it muted.
    expect(days[0].meetings).toHaveLength(4);
    // Sorted chronologically within the day.
    expect(days[0].meetings.map((m) => m.id)).toEqual([
      "todayPast", "todayCancelled", "todayNext", "todayOverlap",
    ]);
  });
});

describe("durationMinutes", () => {
  it("computes minutes and never goes negative", () => {
    expect(durationMinutes({ starts_at: "2026-08-05T09:00:00Z", ends_at: "2026-08-05T10:30:00Z" })).toBe(90);
    expect(durationMinutes({ starts_at: "2026-08-05T10:00:00Z", ends_at: "2026-08-05T09:00:00Z" })).toBe(0);
  });
});

describe("empty state", () => {
  it("returns safe zeros/nulls for no meetings", () => {
    expect(meetingsTodayCount([], NOW, TZ)).toBe(0);
    expect(meetingsThisWeekCount([], NOW, TZ)).toBe(0);
    expect(nextMeeting([], NOW)).toBeNull();
    expect(timelineDays([], NOW, TZ)).toEqual([]);
    expect(busiestDay([], NOW, TZ)).toBeNull();
    expect(busiestOwner([], NOW, TZ)).toBeNull();
    expect(syncHealth([]).healthy).toBe(true);
  });
});

describe("bucketTodayMeetings", () => {
  it("splits today into completed / current / upcoming / cancelled", () => {
    const current = mtg("cur", "2026-08-05T11:30:00Z", "2026-08-05T12:30:00Z"); // spans NOW (12:00)
    const b = bucketTodayMeetings([...ALL, current], NOW, TZ);
    expect(b.completed.map((m) => m.id)).toEqual(["todayPast"]); // ended 10:00
    expect(b.current.map((m) => m.id)).toEqual(["cur"]); // 11:30–12:30
    expect(b.upcoming.map((m) => m.id)).toEqual(["todayNext", "todayOverlap"]);
    expect(b.cancelled.map((m) => m.id)).toEqual(["todayCancelled"]);
  });
});

describe("startsWithinMinutes", () => {
  it("is true only for a not-yet-started meeting inside the window", () => {
    expect(startsWithinMinutes({ starts_at: "2026-08-05T12:20:00Z" }, NOW, 30)).toBe(true); // in 20m
    expect(startsWithinMinutes({ starts_at: "2026-08-05T12:45:00Z" }, NOW, 30)).toBe(false); // in 45m
    expect(startsWithinMinutes({ starts_at: "2026-08-05T11:50:00Z" }, NOW, 30)).toBe(false); // already started
  });
});

describe("upcomingWeekDays / capDays", () => {
  it("excludes today and past/next-week; groups future days only", () => {
    const days = upcomingWeekDays(ALL, NOW, TZ);
    expect(days.map((d) => d.date)).toEqual(["2026-08-06", "2026-08-07"]); // tomorrow, friday
  });
  it("capDays limits the total number of meetings while keeping day order", () => {
    const days = timelineDays(ALL, NOW, TZ); // today(4), tomorrow(1), friday(1)
    const capped = capDays(days, 2);
    expect(capped.reduce((n, d) => n + d.meetings.length, 0)).toBe(2);
    expect(capped[0].date).toBe("2026-08-05");
  });
});

describe("minutesUntil", () => {
  it("ceils whole minutes to the start, never negative", () => {
    expect(minutesUntil({ starts_at: "2026-08-05T12:42:00Z" }, NOW)).toBe(42);
    expect(minutesUntil({ starts_at: "2026-08-05T12:23:30Z" }, NOW)).toBe(24); // 23m30s → 24
    expect(minutesUntil({ starts_at: "2026-08-05T11:00:00Z" }, NOW)).toBe(0); // already past
  });
});

describe("label formatters", () => {
  it("formatDayLabel: Today / Tomorrow / weekday-date", () => {
    expect(formatDayLabel("2026-08-05", NOW, TZ)).toBe("Today");
    expect(formatDayLabel("2026-08-06", NOW, TZ)).toBe("Tomorrow");
    expect(formatDayLabel("2026-08-07", NOW, TZ)).toBe("Fri 7 Aug");
  });
  it("formatTimeInZone: clock time in a zone", () => {
    expect(formatTimeInZone("2026-08-05T14:00:00Z", "UTC")).toBe("14:00");
  });
  it("formatUpcomingDayParts: relative lead + calendar detail", () => {
    // Tomorrow keeps the weekday in the detail for full context.
    expect(formatUpcomingDayParts("2026-08-06", NOW, TZ)).toEqual({
      lead: "Tomorrow",
      detail: "Thursday 6 Aug",
    });
    // Later days lead with the weekday, date as detail.
    expect(formatUpcomingDayParts("2026-08-07", NOW, TZ)).toEqual({
      lead: "Friday",
      detail: "7 Aug",
    });
  });
  it("formatCountdown: minutes, hours, and now", () => {
    expect(formatCountdown(42)).toBe("42 min");
    expect(formatCountdown(75)).toBe("1 h 15 min");
    expect(formatCountdown(120)).toBe("2 h");
    expect(formatCountdown(0)).toBe("now");
  });
});
