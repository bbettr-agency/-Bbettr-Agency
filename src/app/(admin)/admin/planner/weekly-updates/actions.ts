"use server";

/**
 * Weekly Updates — manual add/delete Server Actions.
 *
 * Simple admin+workspace CRUD (NOT a task-domain aggregate → no service-role op).
 * SECURITY: workspace_id and author_user_id are derived SERVER-SIDE from the
 * authenticated admin — the browser supplies only summary/client/date. The
 * weekly_updates RLS (0051) is the backstop: INSERT WITH CHECK requires
 * author = auth.uid() + workspace = current; DELETE USING is author-only. So a
 * crafted request cannot spoof authorship/workspace, and no admin can delete
 * another admin's update.
 */
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";

const WEEKLY_PATH = "/admin/planner/weekly-updates";
const MAX_SUMMARY = 500;

export type WeeklyActionResult = { ok: true; id?: string } | { ok: false; error: string };

export async function addWeeklyUpdateAction(input: {
  summary: string;
  clientId?: string | null;
  updateDate: string; // agency-local YYYY-MM-DD
}): Promise<WeeklyActionResult> {
  if (!isTasksEnabled()) return { ok: false, error: "Weekly Updates is not available." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You must be signed in." };
  if (profile.role !== "admin") return { ok: false, error: "You do not have permission." };
  if (!profile.workspace_id) return { ok: false, error: "Your account is not assigned to a workspace." };

  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (summary.length === 0 || summary.length > MAX_SUMMARY) return { ok: false, error: "Enter a summary of up to 500 characters." };
  if (typeof input.updateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.updateDate)) return { ok: false, error: "Choose a valid date." };
  const clientId = typeof input.clientId === "string" && input.clientId.trim().length > 0 ? input.clientId.trim() : null;

  const supabase = await createClient();
  // author + workspace are set from the trusted session, never the browser; the
  // RLS WITH CHECK re-enforces author = auth.uid() and workspace = current.
  const { data, error } = await supabase
    .from("weekly_updates")
    .insert({ workspace_id: profile.workspace_id, author_user_id: profile.id, summary, client_id: clientId, update_date: input.updateDate })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not save the update. Try again." };
  revalidatePath(WEEKLY_PATH);
  return { ok: true, id: data?.id };
}

export async function deleteWeeklyUpdateAction(input: { id: string }): Promise<WeeklyActionResult> {
  if (!isTasksEnabled()) return { ok: false, error: "Weekly Updates is not available." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You must be signed in." };
  if (profile.role !== "admin") return { ok: false, error: "You do not have permission." };
  if (typeof input.id !== "string" || input.id.trim().length === 0) return { ok: false, error: "Invalid update." };

  const supabase = await createClient();
  // The DELETE RLS policy is author-only: a peer admin's delete matches zero rows
  // (never their row), which is a safe idempotent no-op. The UI only exposes delete
  // on the caller's own manual entries.
  const { error } = await supabase.from("weekly_updates").delete().eq("id", input.id.trim());
  if (error) return { ok: false, error: "Could not delete the update. Try again." };
  revalidatePath(WEEKLY_PATH);
  return { ok: true };
}
