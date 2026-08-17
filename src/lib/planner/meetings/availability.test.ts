import { describe, it, expect } from "vitest";
import {
  wallClockToUtcIso,
  generateBusinessSlots,
  removeOverlapping,
  computeAvailableSlots,
  resolveAllowedSlot,
  groupByDay,
  type Slot,
} from "./availability";

const JHB = "Africa/Johannesburg"; // UTC+2, no DST
const NY = "America/New_York"; // DST zone
const H = 60 * 60_000;

const wall = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const weekday = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(iso));

describe("wallClockToUtcIso (DST/timezone correctness)", () => {
  it("maps 09:00 to the right UTC instant in a fixed-offset zone", () => {
    expect(wallClockToUtcIso("2026-08-24", 540, JHB)).toBe("2026-08-24T07:00:00.000Z"); // 09:00 SAST = 07:00Z
  });
  it("respects DST: NY 09:00 is 13:00Z in summer (EDT) and 14:00Z in winter (EST)", () => {
    expect(wallClockToUtcIso("2026-07-06", 540, NY)).toBe("2026-07-06T13:00:00.000Z"); // EDT UTC-4
    expect(wallClockToUtcIso("2026-12-07", 540, NY)).toBe("2026-12-07T14:00:00.000Z"); // EST UTC-5
  });
});

describe("generateBusinessSlots", () => {
  const now = new Date("2026-08-16T00:00:00Z"); // Sun 02:00 SAST — full clean window ahead
  const slots = generateBusinessSlots({ now, tz: JHB, durationMs: H });

  it("offers Monday–Friday only", () => {
    for (const s of slots) expect(["Saturday", "Sunday"]).not.toContain(weekday(s.startsAt, JHB));
    expect(slots.length).toBeGreaterThan(0);
  });

  it("keeps starts within 09:00–17:00 on a 30-minute grid, honoring the meeting duration", () => {
    const allowedStarts = new Set<string>();
    for (let m = 540; m <= 17 * 60 - 60; m += 30) {
      allowedStarts.add(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    for (const s of slots) {
      expect(allowedStarts.has(wall(s.startsAt, JHB))).toBe(true); // 09:00 … 16:00
      expect(wall(s.endsAt, JHB) <= "17:00").toBe(true); // never past 17:00
      expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(H); // duration respected
    }
  });

  it("uses 30-minute increments and the exact expected shape (10 weekdays × 15 slots)", () => {
    const days = groupByDay(slots, JHB);
    expect(days).toHaveLength(10);
    for (const d of days) {
      expect(d.slots).toHaveLength(15); // 09:00 → 16:00 inclusive, step 30
      for (let i = 1; i < d.slots.length; i++) {
        expect(Date.parse(d.slots[i].startsAt) - Date.parse(d.slots[i - 1].startsAt)).toBe(30 * 60_000);
      }
    }
    expect(slots[0].startsAt).toBe("2026-08-17T07:00:00.000Z"); // Mon 09:00 SAST
  });

  it("stays within the 14-day horizon", () => {
    const last = slots[slots.length - 1].startsAt;
    expect(new Date(last).getTime() - now.getTime()).toBeLessThanOrEqual(14 * 24 * H);
  });

  it("excludes past slots (relative to now)", () => {
    const midMorning = new Date("2026-08-24T07:15:00Z"); // Mon 09:15 SAST
    const s2 = generateBusinessSlots({ now: midMorning, tz: JHB, durationMs: H });
    expect(s2.every((s) => Date.parse(s.startsAt) > midMorning.getTime())).toBe(true);
    const mondaySlots = s2.filter((s) => s.startsAt.startsWith("2026-08-24"));
    expect(mondaySlots.map((s) => wall(s.startsAt, JHB))).not.toContain("09:00"); // 07:00Z ≤ now
    expect(wall(mondaySlots[0].startsAt, JHB)).toBe("09:30"); // first future slot today
  });

  it("30-minute meetings yield 16 starts/day (09:00 → 16:30)", () => {
    const half = generateBusinessSlots({ now, tz: JHB, durationMs: 30 * 60_000 });
    expect(groupByDay(half, JHB)[0].slots).toHaveLength(16);
  });

  it("returns nothing for a non-positive or oversized duration", () => {
    expect(generateBusinessSlots({ now, tz: JHB, durationMs: 0 })).toHaveLength(0);
    expect(generateBusinessSlots({ now, tz: JHB, durationMs: 9 * H })).toHaveLength(0); // > 8h window
  });
});

describe("removeOverlapping (Portal ∩ Google intersection primitive)", () => {
  const slots: Slot[] = [
    { startsAt: "2026-08-17T07:00:00.000Z", endsAt: "2026-08-17T08:00:00.000Z" },
    { startsAt: "2026-08-17T08:00:00.000Z", endsAt: "2026-08-17T09:00:00.000Z" },
  ];

  it("drops a slot that overlaps a busy interval", () => {
    const out = removeOverlapping(slots, [{ startsAt: "2026-08-17T07:15:00.000Z", endsAt: "2026-08-17T07:45:00.000Z" }]);
    expect(out).toHaveLength(1);
    expect(out[0].startsAt).toBe("2026-08-17T08:00:00.000Z");
  });

  it("treats touching intervals as non-overlapping (half-open)", () => {
    const out = removeOverlapping(slots, [{ startsAt: "2026-08-17T08:00:00.000Z", endsAt: "2026-08-17T09:00:00.000Z" }]);
    expect(out).toHaveLength(1);
    expect(out[0].startsAt).toBe("2026-08-17T07:00:00.000Z"); // first slot untouched
  });

  it("ignores malformed intervals", () => {
    expect(removeOverlapping(slots, [{ startsAt: "nonsense", endsAt: "also-bad" }])).toHaveLength(2);
  });
});

describe("computeAvailableSlots (BUSINESS ∩ PORTAL ∩ GOOGLE)", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  it("removes both Portal-busy and Google-busy slots", () => {
    const all = computeAvailableSlots({ now, tz: JHB, durationMs: H, portalBusy: [], googleBusy: [] });
    const portalBusy = [{ startsAt: "2026-08-17T07:00:00.000Z", endsAt: "2026-08-17T07:30:00.000Z" }]; // blocks Mon 09:00
    const googleBusy = [{ startsAt: "2026-08-17T07:30:00.000Z", endsAt: "2026-08-17T08:00:00.000Z" }]; // blocks Mon 09:30
    const filtered = computeAvailableSlots({ now, tz: JHB, durationMs: H, portalBusy, googleBusy });
    expect(filtered.length).toBe(all.length - 2);
    const starts = new Set(filtered.map((s) => s.startsAt));
    expect(starts.has("2026-08-17T07:00:00.000Z")).toBe(false); // portal-blocked
    expect(starts.has("2026-08-17T07:30:00.000Z")).toBe(false); // google-blocked
  });
});

describe("resolveAllowedSlot (confirm-time membership)", () => {
  const opts = { now: new Date("2026-08-16T00:00:00Z"), tz: JHB, durationMs: H };
  it("accepts an exact grid slot and returns the server-derived end", () => {
    const r = resolveAllowedSlot("2026-08-17T07:00:00.000Z", opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endsAt).toBe("2026-08-17T08:00:00.000Z");
  });
  it("rejects an off-grid time, a past time, and garbage", () => {
    expect(resolveAllowedSlot("2026-08-17T07:07:00.000Z", opts).ok).toBe(false); // off-grid
    expect(resolveAllowedSlot("2020-01-01T07:00:00.000Z", opts).ok).toBe(false); // past
    expect(resolveAllowedSlot("not-a-date", opts).ok).toBe(false);
    expect(resolveAllowedSlot("2026-08-16T07:00:00.000Z", opts).ok).toBe(false); // Sunday
  });
});
