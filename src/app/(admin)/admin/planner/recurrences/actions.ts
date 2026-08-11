"use server";

/**
 * Recurring-reminder management actions. v1 = deactivate only ("Stop repeating");
 * there is no edit path. Admin-gated; workspace is server-derived so a request can
 * never target another workspace's definition. The underlying write is
 * service-role (definitions RLS is SELECT-only for admins).
 */
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { isTasksEnabled } from "@/lib/flags";
import { deactivateRecurringDefinition } from "@/lib/planner/recurrence/definitions";

export type RecurrenceActionResult = { ok: true } | { ok: false; error: string };

export async function deactivateRecurringDefinitionAction(input: { id: string }): Promise<RecurrenceActionResult> {
  if (!isTasksEnabled()) return { ok: false, error: "Recurring reminders are not available." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You must be signed in." };
  if (profile.role !== "admin") return { ok: false, error: "You do not have permission." };
  if (!profile.workspace_id) return { ok: false, error: "Your account is not assigned to a workspace." };
  if (typeof input.id !== "string" || input.id.trim().length === 0) return { ok: false, error: "Invalid reminder." };

  try {
    await deactivateRecurringDefinition(profile.workspace_id, input.id.trim());
  } catch {
    return { ok: false, error: "Could not stop the reminder. Try again." };
  }
  revalidatePath("/admin/planner/recurrences");
  return { ok: true };
}
