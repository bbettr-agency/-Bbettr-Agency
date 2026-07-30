import { describe, it, expect } from "vitest";
import { validateMeetingInput, normaliseAttendees, isValidTimeZone } from "./validate";
import { meetingIntent, meetingToDesiredDraft, type MeetingRowLike } from "./desired";
import type { MeetingInput } from "./types";

const validInput: MeetingInput = {
  title: "Kickoff",
  description: "notes",
  startsAt: "2026-08-01T09:00:00.000Z",
  endsAt: "2026-08-01T10:00:00.000Z",
  timeZone: "Africa/Johannesburg",
  hasMeet: true,
  attendees: [{ email: "Guest@Example.com", displayName: "Guest" }],
};

describe("validateMeetingInput", () => {
  it("accepts a valid meeting", () => {
    expect(validateMeetingInput(validInput).ok).toBe(true);
  });
  it("rejects an empty title", () => {
    const r = validateMeetingInput({ ...validInput, title: "  " });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/title/i);
  });
  it("rejects end <= start", () => {
    const r = validateMeetingInput({ ...validInput, endsAt: validInput.startsAt });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/after the start/i);
  });
  it("rejects an invalid time zone", () => {
    const r = validateMeetingInput({ ...validInput, timeZone: "Mars/Phobos" });
    expect(r.ok).toBe(false);
  });
  it("rejects invalid and duplicate attendee emails", () => {
    expect(validateMeetingInput({ ...validInput, attendees: [{ email: "nope" }] }).ok).toBe(false);
    const dup = validateMeetingInput({
      ...validInput,
      attendees: [{ email: "a@b.com" }, { email: "A@B.com" }],
    });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join()).toMatch(/duplicate/i);
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and rejects junk", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Africa/Johannesburg")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});

describe("normaliseAttendees", () => {
  it("lowercases, trims, and dedupes", () => {
    const out = normaliseAttendees([
      { email: " A@B.com ", displayName: " Al " },
      { email: "a@b.com" },
    ]);
    expect(out).toEqual([{ email: "a@b.com", displayName: "Al" }]);
  });
});

describe("meetingIntent / meetingToDesiredDraft", () => {
  const row: MeetingRowLike = {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    title: "Kickoff",
    description: "notes",
    starts_at: "2026-08-01T09:00:00+00:00",
    ends_at: "2026-08-01T10:00:00+00:00",
    time_zone: "Africa/Johannesburg",
    has_meet: true,
    status: "scheduled",
    deleted_at: null,
  };

  it("derives intent from lifecycle", () => {
    expect(meetingIntent(row)).toBe("active");
    expect(meetingIntent({ ...row, status: "cancelled" })).toBe("cancelled");
    expect(meetingIntent({ ...row, deleted_at: "2026-08-01T11:00:00Z" })).toBe("deleted");
    // Soft-delete wins over cancelled.
    expect(meetingIntent({ status: "cancelled", deleted_at: "x" })).toBe("deleted");
  });

  it("maps to a desired draft with normalised instants + attendees", () => {
    const draft = meetingToDesiredDraft(
      row,
      [{ email: "guest@example.com", display_name: "Guest" }],
      "cal@bbettr.com"
    );
    expect(draft).toMatchObject({
      entityType: "meeting",
      entityId: row.id,
      calendarId: "cal@bbettr.com",
      startsAt: "2026-08-01T09:00:00.000Z",
      timeZone: "Africa/Johannesburg",
      wantsMeet: true,
      intent: "active",
      attendees: [{ email: "guest@example.com", displayName: "Guest" }],
    });
  });
});
