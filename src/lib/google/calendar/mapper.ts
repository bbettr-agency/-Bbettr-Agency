import type { MeetState } from "@/lib/database.types";
import type { DesiredEvent } from "@/lib/planner/scheduling/types";
import { googleEventId, meetRequestId } from "./event-id";

/**
 * Pure mapping between a Portal `DesiredEvent` and the Google Calendar event
 * resource. No secrets, no I/O — directly unit-testable.
 */

/** Minimal shape of the Google event resource we read back. */
export interface GoogleEventResource {
  id?: string;
  etag?: string;
  status?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

/** Build the Google event request body from desired Portal state. */
export function toGoogleEventBody(desired: DesiredEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: googleEventId(desired.entityId, desired.idEpoch),
    summary: desired.title,
    description: desired.description ?? undefined,
    start: { dateTime: desired.startsAt, timeZone: desired.timeZone },
    end: { dateTime: desired.endsAt, timeZone: desired.timeZone },
    attendees: desired.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName ?? undefined,
    })),
    status: desired.intent === "cancelled" ? "cancelled" : "confirmed",
  };
  if (desired.wantsMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: meetRequestId(desired.entityId, desired.idEpoch),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

/** Extract the Meet video URL from a Google event, or null. */
export function meetUrlFromEvent(event: GoogleEventResource): string | null {
  const video = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video"
  );
  return video?.uri ?? null;
}

/**
 * Derive the explicit Meet state from a Google event response.
 *  - not requested        → not_requested
 *  - URL present          → ready
 *  - createRequest pending → pending (engine re-polls on next reconcile)
 *  - createRequest failure → failed (+ sanitized code)
 */
export function meetStateFromEvent(
  event: GoogleEventResource,
  wantsMeet: boolean
): { state: MeetState; url: string | null; error: string | null } {
  if (!wantsMeet) return { state: "not_requested", url: null, error: null };
  const url = meetUrlFromEvent(event);
  if (url) return { state: "ready", url, error: null };
  const code = event.conferenceData?.createRequest?.status?.statusCode;
  if (code === "success") return { state: "ready", url: null, error: null };
  if (code === "failure")
    return { state: "failed", url: null, error: "conference_create_failed" };
  // "pending" or absent → still being provisioned.
  return { state: "pending", url: null, error: null };
}
