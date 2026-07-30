import { describe, it, expect } from "vitest";
import { computeDesiredHash } from "./hash";
import type { DesiredEvent } from "./types";

const d: DesiredEvent = {
  entityType: "meeting",
  entityId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  idEpoch: 0,
  calendarId: "cal@example.com",
  title: "Kickoff",
  description: "notes",
  startsAt: "2026-08-01T09:00:00.000Z",
  endsAt: "2026-08-01T10:00:00.000Z",
  timeZone: "Africa/Johannesburg",
  attendees: [
    { email: "b@example.com", displayName: "B" },
    { email: "a@example.com", displayName: "A" },
  ],
  wantsMeet: false,
  intent: "active",
};

describe("computeDesiredHash", () => {
  it("is stable for identical input", () => {
    expect(computeDesiredHash(d)).toBe(computeDesiredHash({ ...d }));
  });

  it("ignores attendee ordering", () => {
    const reordered = { ...d, attendees: [...d.attendees].reverse() };
    expect(computeDesiredHash(reordered)).toBe(computeDesiredHash(d));
  });

  it("changes when a synced field changes", () => {
    expect(computeDesiredHash({ ...d, title: "Changed" })).not.toBe(computeDesiredHash(d));
    expect(computeDesiredHash({ ...d, startsAt: "2026-08-01T09:30:00.000Z" })).not.toBe(
      computeDesiredHash(d)
    );
    expect(computeDesiredHash({ ...d, wantsMeet: true })).not.toBe(computeDesiredHash(d));
  });

  it("changes when the epoch advances (forces rebuild projection)", () => {
    expect(computeDesiredHash({ ...d, idEpoch: 1 })).not.toBe(computeDesiredHash(d));
  });

  it("changes when intent changes", () => {
    expect(computeDesiredHash({ ...d, intent: "cancelled" })).not.toBe(computeDesiredHash(d));
  });
});
