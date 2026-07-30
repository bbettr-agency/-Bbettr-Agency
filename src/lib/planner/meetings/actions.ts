"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PLANNER_ENABLED } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
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
}

const MEETINGS_PATH = "/admin/planner/meetings";

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
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
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
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id: newId };
}

export async function updateMeetingAction(
  id: string,
  input: MeetingInput
): Promise<MeetingActionResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
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
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
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
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();

  const correlationId = newCorrelationId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("meetings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await project(id, correlationId);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}
