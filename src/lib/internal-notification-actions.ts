"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Layout to refresh so the bell's unread count updates, by role. */
function layoutFor(role: string): string {
  return role === "rep" ? "/rep" : "/admin";
}

/** Mark one of the current user's internal notifications as read. */
export async function markInternalReadAction(notificationId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase
    .from("internal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  revalidatePath(layoutFor(profile.role), "layout");
}

/** Mark all of the current user's internal notifications as read. */
export async function markAllInternalReadAction() {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase
    .from("internal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  revalidatePath(layoutFor(profile.role), "layout");
}
