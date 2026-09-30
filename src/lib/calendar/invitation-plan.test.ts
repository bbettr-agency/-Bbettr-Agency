import { describe, it, expect } from "vitest";
import {
  attendeeFacingSignature,
  planInvitations,
  uidForMeeting,
  type AttendeeFacingFields,
  type LedgerRow,
} from "./invitation-plan";
import type { MeetingInvitationStatus } from "@/lib/database.types";

const fields = (over: Partial<AttendeeFacingFields> = {}): AttendeeFacingFields => ({
  summary: "Kickoff",
  startsAtIso: "2026-10-15T09:00:00.000Z",
  endsAtIso: "2026-10-15T10:00:00.000Z",
  timeZone: "Africa/Johannesburg",
  location: "Google Meet",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  description: "Intro call",
  lifecycle: "active",
  ...over,
});

const req = (
  email: string,
  sequence: number,
  sig: string,
  status: MeetingInvitationStatus = "sent"
): LedgerRow => ({ attendee_email: email, method: "request", sequence, content_signature: sig, status });
const can = (
  email: string,
  sequence: number,
  sig: string,
  status: MeetingInvitationStatus = "sent"
): LedgerRow => ({ attendee_email: email, method: "cancel", sequence, content_signature: sig, status });

describe("uidForMeeting", () => {
  it("is the stable namespaced meeting id", () => {
    expect(uidForMeeting("abc-123")).toBe("abc-123@portal.bbettragency.com");
  });
});

describe("attendeeFacingSignature", () => {
  it("is stable for identical attendee-facing content (internal-only changes don't matter)", () => {
    expect(attendeeFacingSignature(fields())).toBe(attendeeFacingSignature(fields()));
  });
  it("changes when start time changes (reschedule)", () => {
    expect(attendeeFacingSignature(fields())).not.toBe(
      attendeeFacingSignature(fields({ startsAtIso: "2026-10-15T11:00:00.000Z" }))
    );
  });
  it("changes when the title changes", () => {
    expect(attendeeFacingSignature(fields())).not.toBe(attendeeFacingSignature(fields({ summary: "Kickoff v2" })));
  });
  it("changes when the attendee-visible description changes", () => {
    expect(attendeeFacingSignature(fields())).not.toBe(attendeeFacingSignature(fields({ description: "New agenda" })));
  });
  it("changes when the Meet URL changes", () => {
    expect(attendeeFacingSignature(fields())).not.toBe(
      attendeeFacingSignature(fields({ meetUrl: "https://meet.google.com/zzz-zzzz-zzz" }))
    );
  });
  it("changes when the meeting is cancelled", () => {
    expect(attendeeFacingSignature(fields())).not.toBe(attendeeFacingSignature(fields({ lifecycle: "cancelled" })));
  });
});

describe("planInvitations — lifecycle", () => {
  it("CREATE: empty ledger → REQUEST seq 0 to all current attendees", () => {
    const out = planInvitations({ currentAttendees: ["a@x.com", "b@y.com"], lifecycle: "active", contentSig: "A", ledger: [] });
    expect(out).toEqual([
      { email: "a@x.com", method: "request", sequence: 0, contentSignature: "A" },
      { email: "b@y.com", method: "request", sequence: 0, contentSignature: "A" },
    ]);
  });

  it("IDEMPOTENT: same content, all already sent → no sends", () => {
    const ledger = [req("a@x.com", 0, "A"), req("b@y.com", 0, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com", "b@y.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([]);
  });

  it("INTERNAL-ONLY change (signature unchanged) → no sends / no bump", () => {
    const ledger = [req("a@x.com", 0, "A")];
    // contentSig still "A" because nothing attendee-facing changed
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([]);
  });

  it("CONTENT CHANGE (reschedule/title/meet/description): bump SEQUENCE, REQUEST to all", () => {
    const ledger = [req("a@x.com", 0, "A"), req("b@y.com", 0, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com", "b@y.com"], lifecycle: "active", contentSig: "B", ledger });
    expect(out).toEqual([
      { email: "a@x.com", method: "request", sequence: 1, contentSignature: "B" },
      { email: "b@y.com", method: "request", sequence: 1, contentSignature: "B" },
    ]);
  });

  it("ATTENDEE ADDED (no content change): only the new attendee gets a REQUEST; remaining untouched", () => {
    const ledger = [req("a@x.com", 0, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com", "b@y.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([{ email: "b@y.com", method: "request", sequence: 0, contentSignature: "A" }]);
  });

  it("ATTENDEE REMOVED: removed attendee gets a CANCEL at a bumped SEQUENCE; remaining untouched", () => {
    const ledger = [req("a@x.com", 0, "A"), req("b@y.com", 0, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([{ email: "b@y.com", method: "cancel", sequence: 1, contentSignature: "A" }]);
  });

  it("CANCEL meeting: every invited attendee gets a CANCEL; none get a REQUEST", () => {
    const ledger = [req("a@x.com", 0, "A"), req("b@y.com", 0, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com", "b@y.com"], lifecycle: "cancelled", contentSig: "C", ledger });
    expect(out).toEqual([
      { email: "a@x.com", method: "cancel", sequence: 1, contentSignature: "C" },
      { email: "b@y.com", method: "cancel", sequence: 1, contentSignature: "C" },
    ]);
  });

  it("CANCEL is idempotent: already-cancelled attendees are not re-cancelled", () => {
    const ledger = [req("a@x.com", 0, "A"), can("a@x.com", 1, "C")];
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "cancelled", contentSig: "C", ledger });
    expect(out).toEqual([]);
  });

  it("FAILED send is retried at the SAME sequence (not a duplicate revision)", () => {
    const ledger = [req("a@x.com", 0, "A", "failed")];
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([{ email: "a@x.com", method: "request", sequence: 0, contentSignature: "A" }]);
  });

  it("MONOTONIC: sequence keeps increasing across successive changes", () => {
    const ledger = [req("a@x.com", 0, "A"), req("a@x.com", 1, "B")];
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "active", contentSig: "C", ledger });
    expect(out).toEqual([{ email: "a@x.com", method: "request", sequence: 2, contentSignature: "C" }]);
  });

  it("RE-ADD: a previously-cancelled attendee who returns gets a fresh REQUEST above their cancel", () => {
    const ledger = [req("a@x.com", 0, "A"), can("a@x.com", 1, "A")];
    const out = planInvitations({ currentAttendees: ["a@x.com"], lifecycle: "active", contentSig: "A", ledger });
    expect(out).toEqual([{ email: "a@x.com", method: "request", sequence: 2, contentSignature: "A" }]);
  });

  it("normalises/dedupes attendee casing", () => {
    const out = planInvitations({ currentAttendees: ["A@X.com", "a@x.com"], lifecycle: "active", contentSig: "A", ledger: [] });
    expect(out).toEqual([{ email: "a@x.com", method: "request", sequence: 0, contentSignature: "A" }]);
  });
});
