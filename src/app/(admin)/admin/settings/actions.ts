"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/internal-notifications";

export interface SettingsActionResult {
  ok?: boolean;
  error?: string;
}

/**
 * Toggle client-portal maintenance mode. Admin-only. Writes the single
 * portal_settings row; clients see the maintenance screen on their next
 * navigation/refresh (no redeploy needed).
 */
export async function setMaintenanceModeAction(
  enabled: boolean
): Promise<SettingsActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("portal_settings")
    .update({ maintenance_mode: enabled, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) return { error: error.message };

  await notifyAdmins({
    type: "maintenance_toggled",
    title: `Maintenance mode ${enabled ? "enabled" : "disabled"}`,
    body: enabled
      ? "Clients now see the maintenance notice."
      : "Clients have normal portal access again.",
    link: "/admin/settings",
  });

  // Refresh the client portal (its layout reads the flag) and the settings page.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/admin/settings");
  return { ok: true };
}
