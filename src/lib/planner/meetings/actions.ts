"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlannerEnabled } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import {
  sendMeetingConfirmationEmail,
  sendNoShowFollowUpEmail,
} from "@/lib/email/meeting-notifications";
import { validateMeetingInput, normaliseAttendees } from "./validate";
import { issueRescheduleToken } from "./reschedule-token";
import type { MeetingInput } from "./types";

/** Canonical public base URL for building client-facing links (same default as notifications). */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/**
 * Meetings server actions. Responsibility is strictly: validate → write Portal
 * data → invoke the reconciliation service. They contain NO synchronization
 * logic — all projection decisions live in the reconciliation layer.
 */

export interface MeetingActionResult {
  ok?: boolean;
  id?: string;
  error?: string;
  /** true when a branded confirmation email was sent to every attendee. */
  emailSent?: boolean;
  /** present when a confirmation email could NOT be delivered (non-fatal). */
  emailWarning?: string;
}

const MEETINGS_PATH = "/admin/planner/meetings";

type NormalisedAttendee = ReturnType<typeof normaliseAttendees>[number];

/**
 * Send the branded Portal confirmation to every attendee (non-fatal). Meeting
 * creation is authoritative and already committed; this only reports honest email
 * status. The Google Meet link is read best-effort via the service-role projection
 * store (admin already verified) and included only if already provisioned.
 */
async function sendConfirmations(
  meetingId: string,
  input: MeetingInput,
  attendees: NormalisedAttendee[]
): Promise<{ emailSent?: boolean; emailWarning?: string }> {
  if (attendees.length === 0) return {}; // no recipients — nothing to confirm

  let meetUrl: string | null = null;
  if (input.hasMeet) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("calendar_projections")
        .select("meet_url")
        .eq("entity_type", "meeting")
        .eq("entity_id", meetingId)
        .maybeSingle();
      meetUrl = data?.meet_url ?? null;
    } catch {
      /* best-effort — omit the Meet link if it can't be read yet */
    }
  }

  let sent = 0;
  let firstError: string | undefined;
  for (const a of attendees) {
    const res = await sendMeetingConfirmationEmail({
      to: a.email,
      attendeeName: a.displayName,
      title: input.title.trim(),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timeZone: input.timeZone,
      meetUrl,
    });
    if (res.ok) sent += 1;
    else if (!firstError) firstError = res.error;
  }
  if (sent === attendees.length) return { emailSent: true };
  // Any failure (partial or total) is NOT "sent to every attendee" — report false
  // and surface a warning so the UI never claims a clean send.
  return {
    emailSent: false,
    emailWarning: firstError
      ? `Confirmation email could not be delivered: ${firstError}`
      : "Confirmation email could not be delivered.",
  };
}

/**
 * Invoke the reconciliation service after a committed write, threading the one
 * correlation id for this request so every downstream log line (service →
 * engine → provider) shares it. Bounded and best-effort: it is AWAITED (not
 * fire-and-forget — a serverless function may be frozen after the response), but
 * any failure is swallowed because the Portal write already succeeded; the row
 * is left pending for the scheduler.
 */
async function project(entityId: string, correlationId: string): Promise<void> {
  try {
    await reconcileMeeting(entityId, correlationId);
  } catch {
    // Intentionally ignored — projection state is persisted; scheduler retries.
  }
}

export async function createMeetingAction(
  input: MeetingInput,
  idempotencyKey?: string
): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const v = validateMeetingInput(input);
  if (!v.ok) return { error: v.errors.join(" ") };

  const correlationId = newCorrelationId();
  const supabase = await createClient();
  const key = idempotencyKey?.trim() || null;

  // Replay-safe: if this key already created a meeting, return it — never a
  // duplicate (refresh / retry / double-click). A concurrent race is caught by
  // the partial-unique index below and resolved by re-reading.
  if (key) {
    const { data: existing } = await supabase
      .from("meetings")
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) return { ok: true, id: existing.id };
  }

  // Atomic: meeting + attendees commit together (or not at all) via a
  // SECURITY-INVOKER RPC, so RLS + the audit trigger still apply. Idempotency is
  // preserved by the unique index: a replay raises a unique-violation and is
  // resolved by re-reading the already-created meeting.
  const attendees = normaliseAttendees(input.attendees);
  const { data: newId, error } = await supabase.rpc(
    "create_meeting_with_attendees",
    {
      p_title: input.title.trim(),
      p_description: input.description?.trim() || null,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_time_zone: input.timeZone,
      p_has_meet: input.hasMeet,
      p_idempotency_key: key,
      p_attendees: attendees.map((a) => ({
        email: a.email,
        display_name: a.displayName,
      })),
    }
  );
  if (error || !newId) {
    // Unique-violation race: another request with the same key won — adopt it.
    if (key) {
      const { data: again } = await supabase
        .from("meetings")
        .select("id")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (again) return { ok: true, id: again.id };
    }
    return { error: error?.message ?? "Could not create the meeting." };
  }

  await project(newId, correlationId);
  // Branded Portal confirmation — STRUCTURALLY non-fatal (the meeting is already
  // committed): the send is wrapped so it can never throw out of the action and
  // leave a created meeting reported as failed. Sent only on a genuine first create
  // (the idempotency replay/adopt paths above return earlier, so a refresh/double-
  // click never re-sends).
  let email: { emailSent?: boolean; emailWarning?: string } = {};
  try {
    email = await sendConfirmations(newId, input, attendees);
  } catch {
    email = { emailSent: false, emailWarning: "Confirmation email could not be delivered." };
  }
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id: newId, ...email };
}

export async function updateMeetingAction(
  id: string,
  input: MeetingInput
): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const v = validateMeetingInput(input);
  if (!v.ok) return { error: v.errors.join(" ") };

  const correlationId = newCorrelationId();
  const supabase = await createClient();

  // Detect a genuine RESCHEDULE (time window changed). Only then do we clear a
  // no-show annotation and retire any outstanding self-service token — the admin
  // has moved the meeting by hand, so a pending client link must not survive and
  // a prior no-show no longer applies. A pure metadata edit (title/description/
  // attendees) leaves those untouched.
  const { data: current } = await supabase
    .from("meetings")
    .select("starts_at, ends_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const timeChanged =
    !current ||
    new Date(current.starts_at).getTime() !== new Date(input.startsAt).getTime() ||
    new Date(current.ends_at).getTime() !== new Date(input.endsAt).getTime();

  const { error } = await supabase
    .from("meetings")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      time_zone: input.timeZone,
      has_meet: input.hasMeet,
      ...(timeChanged
        ? {
            no_show_at: null,
            reschedule_token_hash: null,
            reschedule_token_expires_at: null,
          }
        : {}),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // Replace the attendee set (edited by replacement).
  await supabase.from("meeting_attendees").delete().eq("meeting_id", id);
  const attendees = normaliseAttendees(input.attendees);
  if (attendees.length > 0) {
    await supabase.from("meeting_attendees").insert(
      attendees.map((a) => ({
        meeting_id: id,
        email: a.email,
        display_name: a.displayName,
      }))
    );
  }

  await project(id, correlationId);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}

export async function cancelMeetingAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const correlationId = newCorrelationId();
  const supabase = await createClient();
  // Cancelling also retires any outstanding self-service reschedule token
  // (defense-in-depth: confirm_meeting_reschedule already rejects a non-scheduled
  // meeting, but we don't leave a live link pointing at a cancelled meeting).
  const { error } = await supabase
    .from("meetings")
    .update({
      status: "cancelled",
      reschedule_token_hash: null,
      reschedule_token_expires_at: null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await project(id, correlationId);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}

/**
 * Mark a scheduled meeting as a no-show. This is a PURE ANNOTATION: it sets
 * no_show_at and deliberately does NOT invoke the reconciliation service, so it
 * creates/patches/deletes NO Google event and resends NO guest updates
 * (no_show_at is not part of the projection's desired-state hash). Status stays
 * 'scheduled'; a no-show is not a cancellation.
 */
export async function markNoShowAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .update({ no_show_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Meeting not found, or it is not a scheduled meeting." };

  // Intentionally NO project() — inert to Google by design.
  revalidatePath(MEETINGS_PATH);
  revalidatePath(`${MEETINGS_PATH}/${id}`);
  return { ok: true, id };
}

/**
 * Clear a no-show annotation (admin correction). Leaves the follow-up-sent
 * history intact. Also inert to Google.
 */
export async function unmarkNoShowAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from("meetings")
    .update({ no_show_at: null })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { error: error.message };

  revalidatePath(MEETINGS_PATH);
  revalidatePath(`${MEETINGS_PATH}/${id}`);
  return { ok: true, id };
}

/**
 * Send the no-show follow-up to EVERY attendee (branded Resend, non-fatal). Only
 * valid once the meeting is marked a no-show. Honest delivery status: emailSent
 * is true only when every attendee received it. no_show_followup_sent_at is
 * stamped once (first genuine send) and preserved thereafter as historical
 * evidence — a later reschedule does not clear it.
 */
export async function sendNoShowFollowUpAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, starts_at, ends_at, time_zone, no_show_at, no_show_followup_sent_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return { error: "Meeting not found." };
  if (!meeting.no_show_at)
    return { error: "Mark the meeting as a no-show before sending a follow-up." };

  const { data: attendees } = await supabase
    .from("meeting_attendees")
    .select("email, display_name")
    .eq("meeting_id", id);
  const list = attendees ?? [];
  if (list.length === 0)
    return { error: "This meeting has no attendees to follow up with." };

  // Issue a fresh single-use token and persist ONLY its hash + 14-day expiry.
  // A fresh issue overwrites any prior hash, retiring an earlier outstanding
  // link. Store BEFORE sending so the emailed URL is immediately live; if every
  // send then fails we roll it back (below) so no usable orphan token survives.
  const token = issueRescheduleToken();
  const { error: tokenError } = await supabase
    .from("meetings")
    .update({
      reschedule_token_hash: token.tokenHash,
      reschedule_token_expires_at: token.expiresAt,
    })
    .eq("id", id)
    .eq("status", "scheduled")
    .is("deleted_at", null);
  if (tokenError) return { error: tokenError.message };

  const rescheduleUrl = `${APP_URL}/reschedule/${token.rawToken}`;

  let sent = 0;
  let firstError: string | undefined;
  for (const a of list) {
    const res = await sendNoShowFollowUpEmail({
      to: a.email,
      attendeeName: a.display_name,
      title: meeting.title,
      startsAt: meeting.starts_at,
      endsAt: meeting.ends_at,
      timeZone: meeting.time_zone,
      rescheduleUrl,
    });
    if (res.ok) sent += 1;
    else if (!firstError) firstError = res.error;
  }

  // Total delivery failure → nobody received the raw token, so retire it: a
  // usable link must never outlive an email that wholly failed to send. Do not
  // stamp — nothing went out.
  if (sent === 0) {
    await supabase
      .from("meetings")
      .update({ reschedule_token_hash: null, reschedule_token_expires_at: null })
      .eq("id", id);
    revalidatePath(MEETINGS_PATH);
    revalidatePath(`${MEETINGS_PATH}/${id}`);
    return {
      ok: true,
      id,
      emailSent: false,
      emailWarning: firstError
        ? `Follow-up could not be sent: ${firstError}`
        : "Follow-up could not be sent.",
    };
  }

  // At least one attendee received a working link. Stamp the first genuine send
  // only, preserving it thereafter — historical evidence, not a per-send stamp.
  if (!meeting.no_show_followup_sent_at) {
    await supabase
      .from("meetings")
      .update({ no_show_followup_sent_at: new Date().toISOString() })
      .eq("id", id);
  }

  revalidatePath(MEETINGS_PATH);
  revalidatePath(`${MEETINGS_PATH}/${id}`);
  if (sent === list.length) return { ok: true, id, emailSent: true };
  return {
    ok: true,
    id,
    emailSent: false,
    emailWarning: firstError
      ? `Follow-up could not be delivered to all attendees: ${firstError}`
      : "Follow-up could not be delivered to all attendees.",
  };
}

export async function deleteMeetingAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const correlationId = newCorrelationId();
  const supabase = await createClient();

  // Retire any outstanding self-service reschedule token BEFORE the soft-delete:
  // once deleted_at is set, RLS hides the row from the updater's view, so the
  // token columns could no longer be cleared. confirm_meeting_reschedule already
  // rejects a deleted meeting; this is the active-invalidation the lifecycle
  // requires. Best-effort — the delete proceeds regardless.
  await supabase
    .from("meetings")
    .update({ reschedule_token_hash: null, reschedule_token_expires_at: null })
    .eq("id", id)
    .is("deleted_at", null);

  // Soft-delete via the guarded SECURITY DEFINER RPC. A plain UPDATE setting
  // deleted_at is rejected by RLS (the SELECT visibility policy hides deleted
  // rows, and PostgreSQL forbids updating a row out of the updater's view). The
  // RPC re-checks is_admin() internally, so the authenticated session client is
  // still used and authorization is unchanged. Google projection deletion runs
  // ONLY after the Portal soft-delete has succeeded.
  const { error } = await supabase.rpc("soft_delete_meeting", {
    p_meeting_id: id,
  });
  if (error) return { error: error.message };

  await project(id, correlationId);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}
