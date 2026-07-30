"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PLANNER_ENABLED } from "@/lib/flags";
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
 * Invoke the reconciliation service after a committed write. Bounded and
 * best-effort: it is AWAITED (not fire-and-forget — a serverless function may be
 * frozen after the response), but any failure is swallowed because the Portal
 * write already succeeded; the row is left pending for the scheduler.
 */
async function project(entityId: string): Promise<void> {
  try {
    await reconcileMeeting(entityId);
  } catch {
    // Intentionally ignored — projection state is persisted; scheduler retries.
  }
}

export async function createMeetingAction(
  input: MeetingInput
): Promise<MeetingActionResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();

  const v = validateMeetingInput(input);
  if (!v.ok) return { error: v.errors.join(" ") };

  const supabase = await createClient();
  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      time_zone: input.timeZone,
      has_meet: input.hasMeet,
    })
    .select("id")
    .single();
  if (error || !meeting) {
    return { error: error?.message ?? "Could not create the meeting." };
  }

  const attendees = normaliseAttendees(input.attendees);
  if (attendees.length > 0) {
    await supabase.from("meeting_attendees").insert(
      attendees.map((a) => ({
        meeting_id: meeting.id,
        email: a.email,
        display_name: a.displayName,
      }))
    );
  }

  await project(meeting.id);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id: meeting.id };
}

export async function updateMeetingAction(
  id: string,
  input: MeetingInput
): Promise<MeetingActionResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();

  const v = validateMeetingInput(input);
  if (!v.ok) return { error: v.errors.join(" ") };

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

  await project(id);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}

export async function cancelMeetingAction(id: string): Promise<MeetingActionResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from("meetings")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { error: error.message };

  await project(id);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}

export async function deleteMeetingAction(id: string): Promise<MeetingActionResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();

  const supabase = await createClient();
  const { error } = await supabase
    .from("meetings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await project(id);
  revalidatePath(MEETINGS_PATH);
  return { ok: true, id };
}
