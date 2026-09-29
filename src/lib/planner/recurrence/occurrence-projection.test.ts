import { describe, it, expect } from "vitest";
import {
  projectDefinitionOccurrences,
  userFacingNext,
  RECURRENCE_RECOVERY_LOOKBACK_DAYS,
  type ProjectableDefinition,
} from "./occurrence-projection";

/** Build a definition with sensible defaults for a given rule + watermark. */
function def(overrides: Partial<ProjectableDefinition> & { next_occurrence: string; rule_unit: ProjectableDefinition["rule_unit"] }): ProjectableDefinition {
  return {
    id: overrides.id ?? "def-1",
    rule_unit: overrides.rule_unit,
    rule_interval: overrides.rule_interval ?? 1,
    anchor_day: overrides.anchor_day ?? (overrides.rule_unit === "month" ? Number(overrides.next_occurrence.slice(8, 10)) : null),
    next_occurrence: overrides.next_occurrence,
    due_offset_days: overrides.due_offset_days ?? 0,
    active: overrides.active ?? true,
  };
}

const slots = (occ: { slot: string }[]) => occ.map((o) => o.slot);

describe("projectDefinitionOccurrences — daily (QuickBooks)", () => {
  // Created 29 Sep; the create pass materialised 29 Sep..13 Oct and parked the
  // watermark at 14 Oct. So on 29 Sep the projector adds NOTHING for Today
  // (today's occurrence is already materialised) — no bogus 14 Oct card.
  it("29 Sep, watermark 14 Oct, Today horizon: projects nothing (today already materialised)", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-10-14" });
    expect(projectDefinitionOccurrences(d, "2026-09-29", "2026-09-29")).toEqual([]);
  });

  it("29 Sep, This Week horizon (to Sun 4 Oct), watermark 14 Oct: still nothing (all in-week already materialised)", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-10-14" });
    expect(projectDefinitionOccurrences(d, "2026-09-29", "2026-10-04")).toEqual([]);
  });

  // No 14-day visibility cliff: once the calendar passes the materialised horizon,
  // the projector surfaces the day directly, with NO scheduler having run.
  it("14 Oct (watermark 14 Oct) shows today's occurrence — the cliff is gone", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-10-14" });
    expect(slots(projectDefinitionOccurrences(d, "2026-10-14", "2026-10-14"))).toEqual(["2026-10-14"]);
  });

  it("every day 29 Sep → 15 Oct (watermark stuck at 14 Oct, nothing completed): today always present, overdue never piles, no cliff", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-10-14" });
    for (let i = 0; i < 17; i++) {
      const day = new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10);
      const occ = projectDefinitionOccurrences(d, day, day);
      if (day < "2026-10-14") {
        expect(slots(occ)).toEqual([]); // inside the materialised window — projector adds nothing
      } else {
        // Beyond the watermark the day is surfaced directly (no 14-day cliff), and a
        // stuck-and-uncompleted prior day appears as AT MOST ONE overdue — never a pile.
        expect(slots(occ)).toContain(day);
        expect(occ.filter((o) => o.isOverdue).length).toBeLessThanOrEqual(1);
      }
    }
  });

  // Anti-pile: a daily whose generation was broken for weeks (watermark far in the
  // past) yields at most ONE overdue card + today, never a historical pile.
  it("broken daily (watermark 60 days ago) → at most one overdue + today, never a pile", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-07-31" });
    const occ = projectDefinitionOccurrences(d, "2026-09-29", "2026-09-29");
    expect(slots(occ)).toEqual(["2026-09-28", "2026-09-29"]); // yesterday (overdue) + today
    expect(occ.filter((o) => o.isOverdue)).toHaveLength(1);
  });

  it("broken daily across a week horizon → one overdue + each in-week day, no pile", () => {
    const d = def({ rule_unit: "day", next_occurrence: "2026-07-31" });
    const occ = projectDefinitionOccurrences(d, "2026-09-30", "2026-10-04"); // Wed..Sun
    expect(slots(occ)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(occ.filter((o) => o.isOverdue)).toHaveLength(1); // only 29 Sep is overdue
  });
});

describe("projectDefinitionOccurrences — monthly (Velmoré, 28th)", () => {
  it("28 Sep due today: appears in Today", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-09-28" });
    expect(slots(projectDefinitionOccurrences(d, "2026-09-28", "2026-09-28"))).toEqual(["2026-09-28"]);
  });

  it("29 Sep (not completed): 28 Sep remains, as overdue — never silently vanishes", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-09-28" });
    const occ = projectDefinitionOccurrences(d, "2026-09-29", "2026-09-29");
    expect(slots(occ)).toEqual(["2026-09-28"]);
    expect(occ[0].isOverdue).toBe(true);
  });

  it("within the current week later than the due day → surfaced in the week window as overdue", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-09-28" });
    const occ = projectDefinitionOccurrences(d, "2026-10-01", "2026-10-04");
    expect(slots(occ)).toEqual(["2026-09-28"]);
    expect(occ[0].isOverdue).toBe(true);
  });

  it("28 Oct: October's occurrence exists (recurrence continues past September)", () => {
    // After September is completed the watermark advances to 28 Oct.
    const d = def({ rule_unit: "month", next_occurrence: "2026-10-28" });
    expect(slots(projectDefinitionOccurrences(d, "2026-10-28", "2026-10-28"))).toEqual(["2026-10-28"]);
  });

  it("an outside-the-week future monthly occurrence is NOT pulled into This Week", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-10-28" });
    // Week of 29 Sep (Mon 28 Sep – Sun 4 Oct): 28 Oct is far outside.
    expect(projectDefinitionOccurrences(d, "2026-09-29", "2026-10-04")).toEqual([]);
  });

  it("stale beyond the recovery look-back is dropped (no ancient overdue)", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-06-28" });
    // today far past the lookback window from 28 Jun.
    const occ = projectDefinitionOccurrences(d, "2026-09-29", "2026-09-29");
    // Most-recent past monthly slot ≤ today is 28 Sep (28 Jun→28 Jul→28 Aug→28 Sep),
    // which is within lookback, so exactly one overdue is surfaced (still bounded).
    expect(occ).toHaveLength(1);
    expect(occ[0].slot).toBe("2026-09-28");
  });
});

describe("month-edge / no-drift anchors", () => {
  it("31st anchor clamps per month without drifting (Jan→Feb→Mar)", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-01-31", anchor_day: 31 });
    // Project a wide horizon starting at the watermark day.
    expect(slots(projectDefinitionOccurrences(d, "2026-01-31", "2026-03-31"))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("29th anchor in a leap year hits 29 Feb", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2028-02-29", anchor_day: 29 });
    expect(slots(projectDefinitionOccurrences(d, "2028-02-29", "2028-02-29"))).toEqual(["2028-02-29"]);
  });

  it("30th anchor clamps to 28 Feb in a non-leap year", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-01-30", anchor_day: 30 });
    expect(slots(projectDefinitionOccurrences(d, "2026-01-30", "2026-02-28"))).toEqual(["2026-01-30", "2026-02-28"]);
  });

  it("null anchor_day falls back to the watermark's day-of-month", () => {
    const d: ProjectableDefinition = { id: "d", rule_unit: "month", rule_interval: 1, anchor_day: null, next_occurrence: "2026-03-15", due_offset_days: 0, active: true };
    expect(slots(projectDefinitionOccurrences(d, "2026-03-15", "2026-04-15"))).toEqual(["2026-03-15", "2026-04-15"]);
  });
});

describe("weekly + interval + due offset + inactivity", () => {
  it("weekly surfaces the in-window occurrence and steps by 7", () => {
    const d = def({ rule_unit: "week", next_occurrence: "2026-09-28" }); // a Monday
    expect(slots(projectDefinitionOccurrences(d, "2026-09-28", "2026-10-12"))).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
  });

  it("interval>1 (every 3 days) keeps phase from the watermark", () => {
    const d = def({ rule_unit: "day", rule_interval: 3, next_occurrence: "2026-09-30" });
    expect(slots(projectDefinitionOccurrences(d, "2026-09-30", "2026-10-09"))).toEqual(["2026-09-30", "2026-10-03", "2026-10-06", "2026-10-09"]);
  });

  it("due_offset_days shifts dueDate but not the slot", () => {
    const d = def({ rule_unit: "month", next_occurrence: "2026-09-28", due_offset_days: 2 });
    const occ = projectDefinitionOccurrences(d, "2026-09-28", "2026-09-28");
    expect(occ[0]).toMatchObject({ slot: "2026-09-28", scheduledDate: "2026-09-28", dueDate: "2026-09-30", isOverdue: false });
  });

  it("inactive or null-watermark definitions project nothing", () => {
    expect(projectDefinitionOccurrences(def({ rule_unit: "day", next_occurrence: "2026-09-29", active: false }), "2026-09-29", "2026-09-29")).toEqual([]);
    expect(projectDefinitionOccurrences({ id: "d", rule_unit: "day", rule_interval: 1, anchor_day: null, next_occurrence: null, due_offset_days: 0, active: true }, "2026-09-29", "2026-09-29")).toEqual([]);
  });

  it("lookback constant is the documented 45 days", () => {
    expect(RECURRENCE_RECOVERY_LOOKBACK_DAYS).toBe(45);
  });
});

describe("userFacingNext — what 'Next' means to a human", () => {
  it("daily with today's occurrence outstanding → Next is today (not the watermark)", () => {
    expect(userFacingNext(["2026-09-29", "2026-09-30", "2026-10-14"], "2026-09-29")).toEqual({ slot: "2026-09-29", overdue: false });
  });

  it("after today is completed → Next is tomorrow", () => {
    expect(userFacingNext(["2026-09-30", "2026-10-14"], "2026-09-29")).toEqual({ slot: "2026-09-30", overdue: false });
  });

  it("an outstanding overdue occurrence takes precedence and is flagged overdue", () => {
    expect(userFacingNext(["2026-09-28", "2026-10-28"], "2026-09-29")).toEqual({ slot: "2026-09-28", overdue: true });
  });

  it("oldest overdue wins when several are outstanding", () => {
    expect(userFacingNext(["2026-08-28", "2026-09-28", "2026-10-28"], "2026-09-29")).toEqual({ slot: "2026-08-28", overdue: true });
  });

  it("nothing outstanding/upcoming → null", () => {
    expect(userFacingNext([], "2026-09-29")).toBeNull();
  });
});
