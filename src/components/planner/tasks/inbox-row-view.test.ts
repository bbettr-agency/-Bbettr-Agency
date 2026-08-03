import { describe, it, expect } from "vitest";
import { toInboxRowView, type InboxRowInput } from "./inbox-row-view";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const task = (o: Partial<InboxRowInput> = {}): InboxRowInput => ({
  title: "Call supplier",
  created_at: "2026-08-03T10:00:00.000Z", // 2h before NOW
  created_by: "admin-1",
  ...o,
});

describe("toInboxRowView", () => {
  it("passes the title through unchanged", () => {
    expect(toInboxRowView(task({ title: "  Send invoice " }), null, NOW).title).toBe("  Send invoice ");
  });
  it("produces a deterministic relative label against the injected now", () => {
    const v = toInboxRowView(task(), null, NOW);
    expect(v.capturedRelative).toContain("2 hours ago"); // 10:00 → 12:00
    // deterministic: same inputs → same output
    expect(toInboxRowView(task(), null, NOW).capturedRelative).toBe(v.capturedRelative);
  });
  it("shows a known creator name", () => {
    expect(toInboxRowView(task(), "Eloff", NOW).capturedBy).toBe("Eloff");
  });
  it("omits attribution for an unknown creator (null name)", () => {
    expect(toInboxRowView(task(), null, NOW).capturedBy).toBeNull();
  });
  it("omits attribution for an empty / whitespace name (safe fallback)", () => {
    expect(toInboxRowView(task(), "", NOW).capturedBy).toBeNull();
    expect(toInboxRowView(task(), "   ", NOW).capturedBy).toBeNull();
  });
  it("trims a resolved name", () => {
    expect(toInboxRowView(task(), "  Ashwin  ", NOW).capturedBy).toBe("Ashwin");
  });
  it("retains the exact ISO for the machine-readable <time dateTime>", () => {
    expect(toInboxRowView(task(), null, NOW).capturedAtISO).toBe("2026-08-03T10:00:00.000Z");
  });
  it("provides a non-empty absolute label for a valid date", () => {
    expect(toInboxRowView(task(), null, NOW).capturedAtLabel.length).toBeGreaterThan(0);
  });
  it("does not throw on a malformed created_at; degrades safely", () => {
    const v = toInboxRowView(task({ created_at: "not-a-date" }), "Eloff", NOW);
    expect(v.capturedRelative).toBe("recently");
    expect(v.capturedAtLabel).toBe("");
    expect(v.capturedAtISO).toBe("not-a-date"); // retained verbatim (the <time> simply has no valid label)
    expect(v.capturedBy).toBe("Eloff");
  });
  it("returns only presentation-safe keys (no full Task leaked)", () => {
    expect(Object.keys(toInboxRowView(task(), "Eloff", NOW)).sort()).toEqual(
      ["capturedAtISO", "capturedAtLabel", "capturedBy", "capturedRelative", "title"]
    );
  });
});
