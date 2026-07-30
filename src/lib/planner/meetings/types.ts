/**
 * Meetings domain types (Bbettr OS Planner, Phase 3).
 *
 * These describe the authoritative Portal meeting and its edit DTOs. Nothing
 * here is Google-specific — the projection layer maps a meeting to a calendar
 * event separately.
 */

export interface MeetingAttendeeInput {
  email: string;
  displayName?: string | null;
}

/** Create/update payload for a meeting. */
export interface MeetingInput {
  title: string;
  description?: string | null;
  /** ISO instants (UTC or with offset). */
  startsAt: string;
  endsAt: string;
  /** IANA time zone the meeting is expressed in. */
  timeZone: string;
  hasMeet: boolean;
  attendees: MeetingAttendeeInput[];
}

export interface MeetingValidationResult {
  ok: boolean;
  errors: string[];
}
