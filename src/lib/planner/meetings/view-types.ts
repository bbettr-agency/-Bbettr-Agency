import type { MeetState, ProjectionSyncState, Meeting } from "@/lib/database.types";

/**
 * The ONLY projection data the UI may see (refinement 4). Pure module (no
 * server-only) so client components can import the type. Whitelisted safe fields
 * only — never raw rows, etags, locks, id_epoch or error payloads.
 */
export interface SafeProjectionView {
  entityId: string;
  syncState: ProjectionSyncState;
  meetState: MeetState;
  meetUrl: string | null;
  lastSyncAt: string | null;
}

/**
 * The ONLY meeting fields the CLIENT calendar surface may receive. Whitelist —
 * deliberately EXCLUDES reschedule_token_hash / reschedule_token_expires_at /
 * created_by / idempotency_key etc. so privileged/sensitive columns never cross
 * the RSC boundary into the browser (even on the admin-only page).
 */
export type CalendarMeeting = Pick<
  Meeting,
  | "id"
  | "title"
  | "starts_at"
  | "ends_at"
  | "time_zone"
  | "status"
  | "no_show_at"
  | "attended_at"
  | "no_show_followup_sent_at"
  | "thank_you_sent_at"
>;

/** Project any full meeting row down to the client-safe calendar shape. */
export function toCalendarMeeting(m: CalendarMeeting): CalendarMeeting {
  return {
    id: m.id,
    title: m.title,
    starts_at: m.starts_at,
    ends_at: m.ends_at,
    time_zone: m.time_zone,
    status: m.status,
    no_show_at: m.no_show_at,
    attended_at: m.attended_at,
    no_show_followup_sent_at: m.no_show_followup_sent_at,
    thank_you_sent_at: m.thank_you_sent_at,
  };
}
