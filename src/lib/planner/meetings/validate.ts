import type { MeetingInput, MeetingValidationResult } from "./types";

/**
 * Pure validation for a meeting input. No I/O — directly unit-testable and used
 * by the server actions before any write.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a string is a valid IANA time zone (per the Intl database). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for an unknown zone.
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidInstant(s: string): boolean {
  if (!s) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

export function validateMeetingInput(input: MeetingInput): MeetingValidationResult {
  const errors: string[] = [];

  if (!input.title || input.title.trim().length === 0) {
    errors.push("Title is required.");
  }
  if (!isValidInstant(input.startsAt)) {
    errors.push("Start time is invalid.");
  }
  if (!isValidInstant(input.endsAt)) {
    errors.push("End time is invalid.");
  }
  if (
    isValidInstant(input.startsAt) &&
    isValidInstant(input.endsAt) &&
    Date.parse(input.endsAt) <= Date.parse(input.startsAt)
  ) {
    errors.push("End time must be after the start time.");
  }
  if (!isValidTimeZone(input.timeZone)) {
    errors.push("Time zone is not a valid IANA zone.");
  }
  const seen = new Set<string>();
  for (const a of input.attendees) {
    const email = a.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      errors.push(`Attendee email is invalid: ${a.email}`);
    } else if (seen.has(email)) {
      errors.push(`Duplicate attendee: ${email}`);
    } else {
      seen.add(email);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Normalise attendees: trim, lowercase email, drop duplicates. */
export function normaliseAttendees(
  attendees: MeetingInput["attendees"]
): { email: string; displayName: string | null }[] {
  const seen = new Set<string>();
  const out: { email: string; displayName: string | null }[] = [];
  for (const a of attendees) {
    const email = a.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, displayName: a.displayName?.trim() || null });
  }
  return out;
}
