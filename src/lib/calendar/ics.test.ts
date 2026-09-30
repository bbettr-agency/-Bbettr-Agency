import { describe, it, expect } from "vitest";
import {
  buildInvitationIcs,
  escapeText,
  foldLine,
  formatLocal,
  formatUtcStamp,
  type IcsInput,
} from "./ics";

const base: IcsInput = {
  method: "request",
  uid: "11111111-1111-4111-8111-111111111111@portal.bbettragency.com",
  sequence: 0,
  dtStampIso: "2026-09-30T10:15:00.000Z",
  startsAtIso: "2026-10-15T09:00:00.000Z", // 11:00 in Afric/Johannesburg (+02:00)
  endsAtIso: "2026-10-15T10:00:00.000Z", // 12:00
  timeZone: "Africa/Johannesburg",
  summary: "Bbettr Website X Emirates Textiles",
  description: "Kickoff call. Join Google Meet: https://meet.google.com/abc-defg-hij",
  location: "https://meet.google.com/abc-defg-hij",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  organizerEmail: "portal@bbettragency.com",
  organizerName: "Bbettr Agency (Eloff Sander)",
  attendee: { email: "ayaz@emirates-textiles.co.za", name: "Ayaz" },
};

describe("ics escaping / folding / formatting", () => {
  it("escapes TEXT specials (backslash, semicolon, comma, newline)", () => {
    expect(escapeText("a; b, c \\ d\ne")).toBe("a\\; b\\, c \\\\ d\\ne");
  });

  it("folds long lines at <=75 octets with CRLF + leading space", () => {
    const line = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldLine(line);
    for (const seg of folded.split("\r\n")) {
      expect(Buffer.byteLength(seg, "utf8")).toBeLessThanOrEqual(75);
    }
    // continuation lines start with a single space
    const parts = folded.split("\r\n");
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
  });

  it("formats Africa/Johannesburg local wall-clock (UTC+2, no DST)", () => {
    expect(formatLocal("2026-10-15T09:00:00.000Z", "Africa/Johannesburg")).toBe("20261015T110000");
  });

  it("formats a UTC DTSTAMP", () => {
    expect(formatUtcStamp("2026-09-30T10:15:00.000Z")).toBe("20260930T101500Z");
  });
});

/** Reverse RFC 5545 line folding for content assertions (CRLF + leading space). */
const unfold = (s: string): string => s.replace(/\r\n /g, "");

describe("buildInvitationIcs — REQUEST", () => {
  const ics = buildInvitationIcs(base);
  const flat = unfold(ics);

  it("is a well-formed VCALENDAR with CRLF endings and METHOD:REQUEST", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("carries the stable UID and the supplied SEQUENCE", () => {
    expect(ics).toContain("UID:11111111-1111-4111-8111-111111111111@portal.bbettragency.com");
    expect(ics).toContain("SEQUENCE:0");
  });

  it("emits TZID times + a fixed +0200 VTIMEZONE", () => {
    expect(ics).toContain("DTSTART;TZID=Africa/Johannesburg:20261015T110000");
    expect(ics).toContain("DTEND;TZID=Africa/Johannesburg:20261015T120000");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:Africa/Johannesburg");
    expect(ics).toContain("TZOFFSETTO:+0200");
  });

  it("uses portal@ as ORGANIZER with the host in the CN, and the attendee with RSVP", () => {
    expect(flat).toContain("ORGANIZER;CN=Bbettr Agency (Eloff Sander):mailto:portal@bbettragency.com");
    expect(flat).toContain("ATTENDEE;CN=Ayaz;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ayaz@emirates-textiles.co.za");
  });

  it("includes the Meet URL as URL + LOCATION", () => {
    expect(flat).toContain("URL:https://meet.google.com/abc-defg-hij");
    expect(flat).toContain("LOCATION:https://meet.google.com/abc-defg-hij");
  });
});

describe("buildInvitationIcs — CANCEL", () => {
  const ics = buildInvitationIcs({ ...base, method: "cancel", sequence: 2 });
  it("is METHOD:CANCEL + STATUS:CANCELLED with a higher SEQUENCE and same UID", () => {
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("UID:11111111-1111-4111-8111-111111111111@portal.bbettragency.com");
  });
});

describe("buildInvitationIcs — injection & escaping safety", () => {
  it("escapes commas/semicolons in SUMMARY and strips CRLF from UID/addresses", () => {
    const ics = buildInvitationIcs({
      ...base,
      summary: "Plan; phase 1, phase 2",
      uid: "abc\r\nX-EVIL:1@portal.bbettragency.com",
      organizerName: "Bbettr\r\nAgency",
    });
    expect(ics).toContain("SUMMARY:Plan\\; phase 1\\, phase 2");
    // CRLF collapsed to a space → never a standalone injected content line.
    expect(ics).not.toContain("\r\nX-EVIL:1");
    expect(ics).toContain("UID:abc X-EVIL:1@portal.bbettragency.com");
  });
});
