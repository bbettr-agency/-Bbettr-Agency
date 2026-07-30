import type { DesiredDraft, ProjectionIntent } from "@/lib/planner/scheduling/types";

/**
 * Pure mapping from an authoritative meeting row (+ attendees) to the desired
 * projection draft. No I/O — unit-testable. This is the single place that
 * derives projection intent from meeting lifecycle:
 *   soft-deleted → deleted, cancelled → cancelled, otherwise → active.
 */

export interface MeetingRowLike {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  has_meet: boolean;
  status: "scheduled" | "cancelled";
  deleted_at: string | null;
}

export interface AttendeeRowLike {
  email: string;
  display_name: string | null;
}

export function meetingIntent(row: Pick<MeetingRowLike, "status" | "deleted_at">): ProjectionIntent {
  if (row.deleted_at) return "deleted";
  if (row.status === "cancelled") return "cancelled";
  return "active";
}

export function meetingToDesiredDraft(
  row: MeetingRowLike,
  attendees: AttendeeRowLike[],
  calendarId: string
): DesiredDraft {
  return {
    entityType: "meeting",
    entityId: row.id,
    calendarId,
    title: row.title,
    description: row.description,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    timeZone: row.time_zone,
    wantsMeet: row.has_meet,
    attendees: attendees.map((a) => ({
      email: a.email,
      displayName: a.display_name,
    })),
    intent: meetingIntent(row),
  };
}
