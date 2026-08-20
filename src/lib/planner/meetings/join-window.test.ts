import { describe, it, expect } from "vitest";
import { isJoinProminent, JOIN_LEAD_MS } from "./join-window";

const start = Date.parse("2026-09-01T10:00:00Z");
const S = "2026-09-01T10:00:00Z";
const E = "2026-09-01T10:30:00Z";

describe("isJoinProminent", () => {
  it("is NOT prominent long before the start", () => {
    expect(isJoinProminent(start - 60 * 60_000, S, E)).toBe(false);
  });
  it("is NOT prominent just before the 10-minute lead", () => {
    expect(isJoinProminent(start - JOIN_LEAD_MS - 1000, S, E)).toBe(false);
  });
  it("becomes prominent exactly at T-10min", () => {
    expect(isJoinProminent(start - JOIN_LEAD_MS, S, E)).toBe(true);
  });
  it("is prominent during the meeting", () => {
    expect(isJoinProminent(start + 5 * 60_000, S, E)).toBe(true);
  });
  it("is prominent at the exact end instant, not after", () => {
    expect(isJoinProminent(Date.parse(E), S, E)).toBe(true);
    expect(isJoinProminent(Date.parse(E) + 1000, S, E)).toBe(false);
  });
  it("returns false for malformed dates (never a broken prominent state)", () => {
    expect(isJoinProminent(start, "nonsense", E)).toBe(false);
  });
});
