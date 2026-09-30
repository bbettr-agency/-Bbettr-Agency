/**
 * Standards-compliant iCalendar (.ics) builder for Bbettr meeting invitations.
 *
 * PURE — no I/O, no secrets, fully unit-testable. Produces an RFC 5545 VCALENDAR
 * with METHOD:REQUEST (create/update) or METHOD:CANCEL (cancellation), CRLF line
 * endings, 75-octet line folding, and proper text escaping. The Portal delivers
 * this through Resend; Google Calendar no longer emails guests.
 *
 * Design invariants (approved):
 *  - UID is the STABLE Portal meeting identity (<meeting-id>@portal.bbettragency.com)
 *    and never changes across reschedule / title change / cancel / Google rebuild.
 *  - SEQUENCE is supplied by the caller (durable + monotonic, from the ledger).
 *  - ORGANIZER is the authenticated delivery identity (portal@bbettragency.com);
 *    the human host (Eloff/Ashwin) lives in the attendee-facing email copy and the
 *    ORGANIZER CN, not in the machine ORGANIZER address.
 *  - Times are emitted with TZID + a VTIMEZONE whose offset is computed for the
 *    event instant (Africa/Johannesburg is a fixed +02:00, no DST), so the absolute
 *    time is unambiguous across Outlook / Gmail / Apple Calendar.
 */

export interface IcsAttendee {
  email: string;
  name?: string | null;
}

export interface IcsInput {
  method: "request" | "cancel";
  /** Stable UID for the meeting's lifetime. */
  uid: string;
  /** Durable, monotonic revision number (from the ledger). */
  sequence: number;
  /** DTSTAMP — the moment this invitation object was produced (UTC). Injectable. */
  dtStampIso: string;
  startsAtIso: string;
  endsAtIso: string;
  /** IANA time zone (e.g. "Africa/Johannesburg"). */
  timeZone: string;
  summary: string;
  description?: string | null;
  /** Human location text and/or the Meet URL. */
  location?: string | null;
  meetUrl?: string | null;
  /** Authenticated delivery identity (portal@bbettragency.com). */
  organizerEmail: string;
  /** Display name for ORGANIZER (may include the human host). */
  organizerName: string;
  attendee: IcsAttendee;
}

const PRODID = "-//Bbettr Agency//Portal Meetings//EN";

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Strip CR/LF from a value that becomes part of a single content line's tokens
 *  (UID, addresses, params) — defense against content-line/header injection. */
function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const utf8Len = (s: string): number => {
  // Byte length without requiring Buffer (portable across runtimes).
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4;
  }
  return n;
};

/** Fold one content line to <=75 octets per line, continuation lines prefixed by a
 *  single space (RFC 5545 §3.1). Never splits a multi-byte character. */
export function foldLine(line: string): string {
  if (utf8Len(line) <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let first = true;
  for (const ch of line) {
    const chBytes = utf8Len(ch);
    const limit = first ? 75 : 74; // continuation lines carry a leading space (1 octet)
    if (curBytes + chBytes > limit) {
      out.push(cur);
      cur = ch;
      curBytes = chBytes;
      first = false;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) out.push(cur);
  return out.map((seg, i) => (i === 0 ? seg : ` ${seg}`)).join("\r\n");
}

/** Wall-clock + offset parts of an instant in a given IANA zone. */
function zonedParts(iso: string, tz: string): {
  y: string; m: string; d: string; H: string; Min: string; S: string; offsetMin: number;
} {
  const date = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  const offsetMin = Math.round((asUTC - date.getTime()) / 60000);
  return { y: map.year, m: map.month, d: map.day, H: map.hour, Min: map.minute, S: map.second, offsetMin };
}

/** Local wall-clock as YYYYMMDDTHHMMSS in the given zone. */
export function formatLocal(iso: string, tz: string): string {
  const p = zonedParts(iso, tz);
  return `${p.y}${p.m}${p.d}T${p.H}${p.Min}${p.S}`;
}

/** UTC stamp as YYYYMMDDTHHMMSSZ. */
export function formatUtcStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** "+0200" / "-0500" for a given offset in minutes. */
function offsetString(offsetMin: number): string {
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

/** A single-observance VTIMEZONE valid for the event instant. Correct absolute time
 *  for a fixed-offset zone (Africa/Johannesburg = +02:00 year-round). */
function vtimezone(tz: string, startsAtIso: string): string[] {
  const { offsetMin } = zonedParts(startsAtIso, tz);
  const off = offsetString(offsetMin);
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${stripCrlf(tz)}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${off}`,
    `TZOFFSETTO:${off}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/**
 * Build the full VCALENDAR/VEVENT for one recipient. Deterministic given its input
 * (inject `dtStampIso` for stable tests).
 */
export function buildInvitationIcs(input: IcsInput): string {
  const isCancel = input.method === "cancel";
  const method = isCancel ? "CANCEL" : "REQUEST";
  const status = isCancel ? "CANCELLED" : "CONFIRMED";

  const organizerName = stripCrlf(input.organizerName);
  const organizerEmail = stripCrlf(input.organizerEmail);
  const attendeeEmail = stripCrlf(input.attendee.email);
  const attendeeName = input.attendee.name ? stripCrlf(input.attendee.name) : null;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    ...vtimezone(input.timeZone, input.startsAtIso),
    "BEGIN:VEVENT",
    `UID:${stripCrlf(input.uid)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `DTSTAMP:${formatUtcStamp(input.dtStampIso)}`,
    `DTSTART;TZID=${stripCrlf(input.timeZone)}:${formatLocal(input.startsAtIso, input.timeZone)}`,
    `DTEND;TZID=${stripCrlf(input.timeZone)}:${formatLocal(input.endsAtIso, input.timeZone)}`,
    `SUMMARY:${escapeText(input.summary)}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (input.meetUrl) lines.push(`URL:${escapeText(input.meetUrl)}`);

  lines.push(`STATUS:${status}`);
  lines.push(
    `ORGANIZER;CN=${escapeText(organizerName)}:mailto:${organizerEmail}`
  );
  const cnParam = attendeeName ? `;CN=${escapeText(attendeeName)}` : "";
  lines.push(
    `ATTENDEE${cnParam};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendeeEmail}`
  );
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
