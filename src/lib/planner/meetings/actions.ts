"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlannerEnabled } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import { sendMeetingConfirmationEmail } from "@/lib/email/meeting-notifications";
import { validateMeetingInput, normaliseAttendees } from "./validate";
import type { MeetingInput } from "./types";

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
  const { error } = await supabase
    .from("meetings")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      time_zone: input.timeZone,
      has_meet: input.hasMeet,
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
  const { error } = await supabase
    .from("meetings")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { error: error.message };

  await project(id, correlationId);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}

export async function deleteMeetingAction(id: string): Promise<MeetingActionResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();

  const correlationId = newCorrelationId();
  const supabase = await createClient();

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
