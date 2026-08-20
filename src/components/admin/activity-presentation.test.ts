import { describe, it, expect } from "vitest";
import {
  buildActivityRows,
  selectRecent,
  rowEventCount,
  GROUPABLE_TYPES,
  ADMIN_RECENT_ROWS,
  CLIENT_HOME_RECENT,
  type ActivityEventLike,
} from "./activity-presentation";

let seq = 0;
const ev = (
  type: string,
  visibility: "client" | "internal" = "client",
  occurred_at = "2026-01-01T00:00:00Z"
): ActivityEventLike => ({
  id: `e${seq++}`,
  type,
  title: type,
  description: null,
  visibility,
  occurred_at,
  source: "system",
});
const file = (v: "client" | "internal" = "client") => ev("file_uploaded", v);

// Total underlying events across all rows — the "nothing is lost" invariant.
const totalEvents = (rows: ReturnType<typeof buildActivityRows>) =>
  rows.reduce((n, r) => n + rowEventCount(r), 0);

describe("buildActivityRows — grouping is display-only, never destructive", () => {
  it("returns no rows for an empty list", () => {
    expect(buildActivityRows([])).toEqual([]);
  });

  it("keeps a lone file upload as a normal event row (not a group)", () => {
    const rows = buildActivityRows([file()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("event");
  });

  it("collapses a run of 2+ consecutive same-visibility uploads into one group", () => {
    const rows = buildActivityRows([file(), file(), file(), file()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("file_group");
    if (rows[0].kind === "file_group") {
      expect(rows[0].count).toBe(4);
      expect(rows[0].events).toHaveLength(4);
    }
  });

  it("does NOT group uploads separated by another event (two groups, not one)", () => {
    const rows = buildActivityRows([file(), file(), ev("invoice_paid"), file(), file()]);
    expect(rows.map((r) => r.kind)).toEqual(["file_group", "event", "file_group"]);
  });

  it("does NOT merge uploads of different visibility", () => {
    const rows = buildActivityRows([file("client"), file("internal")]);
    // Different visibility ⇒ two separate single rows, not one group.
    expect(rows.map((r) => r.kind)).toEqual(["event", "event"]);
  });

  it("never drops or duplicates an event (mixed stream)", () => {
    const events = [
      ev("stage_advanced"),
      file(),
      file(),
      file(),
      ev("invoice_paid"),
      ev("onboarding_submitted"),
      file(),
    ];
    const rows = buildActivityRows(events);
    expect(totalEvents(rows)).toBe(events.length); // M / K: nothing orphaned
  });

  it("preserves chronological order of the source list", () => {
    const events = [ev("a"), ev("b"), file(), file(), ev("c")];
    const rows = buildActivityRows(events);
    // First row is 'a', last is 'c' — order intact around the group.
    const first = rows[0];
    const last = rows[rows.length - 1];
    expect(first.kind).toBe("event");
    expect(last.kind).toBe("event");
    if (first.kind === "event") expect(first.event.type).toBe("a");
    if (last.kind === "event") expect(last.event.type).toBe("c");
  });

  it("only file_uploaded is groupable", () => {
    expect(GROUPABLE_TYPES.has("file_uploaded")).toBe(true);
    expect(GROUPABLE_TYPES.has("invoice_paid")).toBe(false);
    const rows = buildActivityRows([ev("invoice_paid"), ev("invoice_paid")]);
    expect(rows.map((r) => r.kind)).toEqual(["event", "event"]);
  });
});

describe("selectRecent — bounded recent view + more-exists signal", () => {
  it("shows nothing and reports no more for an empty list", () => {
    const v = selectRecent([], ADMIN_RECENT_ROWS);
    expect(v.rows).toEqual([]);
    expect(v.hasMoreRows).toBe(false);
  });

  it("shows all rows and reports no more when fewer than the limit", () => {
    const v = selectRecent([ev("a"), ev("b"), ev("c")], ADMIN_RECENT_ROWS);
    expect(v.rows).toHaveLength(3);
    expect(v.hasMoreRows).toBe(false);
  });

  it("caps at the limit and reports more when there are extra rows", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(`e${i}`));
    const v = selectRecent(events, ADMIN_RECENT_ROWS);
    expect(v.rows).toHaveLength(ADMIN_RECENT_ROWS);
    expect(v.hasMoreRows).toBe(true);
  });

  it("counts grouped uploads as ONE row toward the limit (compression buys room)", () => {
    // 10 consecutive uploads collapse to a single row, so the recent view is
    // NOT full despite 10 underlying events.
    const events = Array.from({ length: 10 }, () => file());
    const v = selectRecent(events, ADMIN_RECENT_ROWS);
    expect(v.rows).toHaveLength(1);
    expect(v.hasMoreRows).toBe(false);
  });
});

describe("presentation constants", () => {
  it("admin recent budget and client preview are small, sane numbers", () => {
    expect(ADMIN_RECENT_ROWS).toBe(8);
    expect(CLIENT_HOME_RECENT).toBe(5);
  });
});
