import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { newCorrelationId } from "@/lib/net";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import { sendMeetingConfirmationEmail } from "@/lib/email/meeting-notifications";
import { listBusyIntervals } from "@/lib/google/calendar/availability";
import { hashRescheduleToken, isWellFormedRawToken } from "./reschedule-token";
import {
  computeAvailableSlots,
  generateBusinessSlots,
  groupByDay,
  removeOverlapping,
  resolveAllowedSlot,
  type DaySlots,
  type TimeInterval,
} from "./availability";

/**
 * Server-only orchestration for the PUBLIC self-service reschedule flow. The raw
 * token (from the /reschedule/<token> URL) is the sole authorization: it is
 * hashed and matched with the service-role client — the browser never sees a
 * meeting id, the token hash, or any other meeting/client data. Google
 * availability failures FAIL CLOSED (no slots / unavailable), never falling back
 * to Portal-only availability.
 */

interface ResolvedMeeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
}

/** What the public page may know about the meeting — never the id. */
export interface ReschedulePublicMeeting {
  title: string;
  currentStartsAt: string;
  currentEndsAt: string;
  timeZone: string;
}

export type RescheduleView =
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "ok"; meeting: ReschedulePublicMeeting; days: DaySlots[] };

export type ConfirmResult =
  | { status: "ok"; meeting: { title: string; startsAt: string; endsAt: string; timeZone: string } }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "slot_taken" }
  | { status: "slot_invalid" }
  | { status: "error" };

function publicShape(m: ResolvedMeeting): ReschedulePublicMeeting {
  return {
    title: m.title,
    currentStartsAt: m.starts_at,
    currentEndsAt: m.ends_at,
    timeZone: m.time_zone,
  };
}

/**
 * Resolve a raw token to its meeting via SHA-256 hash. Usable ONLY when: hash
 * matches, not expired, status='scheduled', not deleted, token still populated.
 * no_show_at is intentionally NOT a condition — a no-show is exactly the meeting
 * we expect to be rescheduled. Returns null for every non-usable case (no
 * enumeration: caller shows one generic message).
 */
async function resolveMeeting(rawToken: string): Promise<ResolvedMeeting | null> {
  if (!isWellFormedRawToken(rawToken)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("meetings")
    .select("id, title, starts_at, ends_at, time_zone")
    .eq("reschedule_token_hash", hashRescheduleToken(rawToken))
    .gt("reschedule_token_expires_at", new Date().toISOString())
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .maybeSingle();
  return data ?? null;
}

/** Active OTHER Portal meetings overlapping [minIso, maxIso), as busy intervals. */
async function fetchPortalBusy(
  excludeId: string,
  minIso: string,
  maxIso: string
): Promise<TimeInterval[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("meetings")
    .select("starts_at, ends_at")
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .neq("id", excludeId)
    .lt("starts_at", maxIso)
    .gt("ends_at", minIso);
  return (data ?? []).map((m) => ({ startsAt: m.starts_at, endsAt: m.ends_at }));
}

function durationMsOf(m: ResolvedMeeting): number {
  return Date.parse(m.ends_at) - Date.parse(m.starts_at);
}

/**
 * Public page data: the meeting summary + the fully-verified available slots
 * (BUSINESS ∩ PORTAL ∩ GOOGLE). Google failure → { unavailable } (fail closed).
 * Invalid/expired/consumed link → { invalid }.
 */
export async function loadRescheduleView(
  rawToken: string,
  now: Date = new Date()
): Promise<RescheduleView> {
  let meeting: ResolvedMeeting | null;
  try {
    meeting = await resolveMeeting(rawToken);
  } catch {
    return { status: "invalid" };
  }
  if (!meeting) return { status: "invalid" };

  const tz = meeting.time_zone;
  const durationMs = durationMsOf(meeting);
  const base = generateBusinessSlots({ now, tz, durationMs });
  if (base.length === 0) {
    return { status: "ok", meeting: publicShape(meeting), days: [] };
  }

  const minIso = base[0].startsAt;
  const maxIso = base[base.length - 1].endsAt;

  let portalBusy: TimeInterval[];
  let googleBusy: TimeInterval[];
  try {
    // Google availability is required. If it can't be verified for ANY reason
    // (timeout / API / auth / not configured / malformed), fail closed.
    googleBusy = await listBusyIntervals({ timeMinIso: minIso, timeMaxIso: maxIso, tz });
  } catch {
    return { status: "unavailable" };
  }
  try {
    portalBusy = await fetchPortalBusy(meeting.id, minIso, maxIso);
  } catch {
    return { status: "unavailable" };
  }

  const slots = computeAvailableSlots({ now, tz, durationMs, portalBusy, googleBusy });
  return { status: "ok", meeting: publicShape(meeting), days: groupByDay(slots, tz) };
}

/**
 * Confirm a chosen slot. The slot shown at page load is NOT authorization: every
 * layer is re-checked server-side immediately before the mutation —
 *   1. re-resolve the token (lifecycle),
 *   2. the submitted start must be an exact business-hour grid slot (not past),
 *   3. re-check Portal overlap,
 *   4. re-check Google (fail closed on any inability),
 * then and only then the atomic, service-role-only confirm_meeting_reschedule()
 * makes the final, authoritative Portal-side overlap check + token consumption.
 * The slot END is derived server-side from the meeting duration — never trusted
 * from the client.
 */
export async function confirmRescheduleByToken(
  rawToken: string,
  slotStartIso: string,
  now: Date = new Date()
): Promise<ConfirmResult> {
  let meeting: ResolvedMeeting | null;
  try {
    meeting = await resolveMeeting(rawToken);
  } catch {
    return { status: "invalid" };
  }
  if (!meeting) return { status: "invalid" };

  const tz = meeting.time_zone;
  const durationMs = durationMsOf(meeting);

  // (2) Server-derived slot end + membership in the business grid (rejects
  // arbitrary/past times and any client-side duration tampering).
  const allowed = resolveAllowedSlot(slotStartIso, { now, tz, durationMs });
  if (!allowed.ok) return { status: "slot_invalid" };
  const slotEndIso = allowed.endsAt;
  const slot: TimeInterval = { startsAt: slotStartIso, endsAt: slotEndIso };

  // (3) Portal overlap re-check.
  try {
    const portalBusy = await fetchPortalBusy(meeting.id, slotStartIso, slotEndIso);
    if (removeOverlapping([slot], portalBusy).length === 0) return { status: "slot_taken" };
  } catch {
    return { status: "unavailable" };
  }

  // (4) Google re-check for exactly this slot — fail closed on any inability.
  try {
    const googleBusy = await listBusyIntervals({ timeMinIso: slotStartIso, timeMaxIso: slotEndIso, tz });
    if (removeOverlapping([slot], googleBusy).length === 0) return { status: "slot_taken" };
  } catch {
    return { status: "unavailable" };
  }

  // (5) Atomic Portal-side confirm + token consumption (the final authority).
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("confirm_meeting_reschedule", {
    p_token_hash: hashRescheduleToken(rawToken),
    p_starts_at: slotStartIso,
    p_ends_at: slotEndIso,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("slot_taken")) return { status: "slot_taken" };
    if (msg.includes("reschedule_link_invalid")) return { status: "invalid" };
    if (msg.includes("invalid_slot")) return { status: "slot_invalid" };
    return { status: "error" };
  }
  const meetingId = typeof data === "string" ? data : meeting.id;

  // Portal is committed. Project the SAME Google event to the new time (reuse the
  // existing reconcile path — patches google_event_id in place; no new event, no
  // new Meet). Best-effort: a projection failure leaves the row pending for the
  // scheduler and never rolls back the committed reschedule.
  const correlationId = newCorrelationId();
  try {
    await reconcileMeeting(meetingId, correlationId);
  } catch {
    /* pending for scheduler */
  }

  // Best-effort branded confirmation to attendees (makes the "a confirmation
  // will be sent" promise real). Never blocks or fails the reschedule.
  await sendRescheduleConfirmations(meetingId, meeting.title, slotStartIso, slotEndIso, tz);

  return {
    status: "ok",
    meeting: { title: meeting.title, startsAt: slotStartIso, endsAt: slotEndIso, timeZone: tz },
  };
}

/** Send the meeting confirmation (new time) to every attendee. Best-effort. */
async function sendRescheduleConfirmations(
  meetingId: string,
  title: string,
  startsAt: string,
  endsAt: string,
  timeZone: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: attendees }, { data: projection }] = await Promise.all([
      admin.from("meeting_attendees").select("email, display_name").eq("meeting_id", meetingId),
      admin
        .from("calendar_projections")
        .select("meet_url")
        .eq("entity_type", "meeting")
        .eq("entity_id", meetingId)
        .maybeSingle(),
    ]);
    const meetUrl = projection?.meet_url ?? null;
    for (const a of attendees ?? []) {
      await sendMeetingConfirmationEmail({
        to: a.email,
        attendeeName: a.display_name,
        title,
        startsAt,
        endsAt,
        timeZone,
        meetUrl,
      });
    }
  } catch {
    /* best-effort */
  }
}
