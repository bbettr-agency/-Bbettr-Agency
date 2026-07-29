"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnectGoogle } from "@/lib/google";

export interface IntegrationsActionResult {
  ok?: boolean;
  error?: string;
}

/**
 * Disconnect QuickBooks: remove the stored (encrypted) tokens. The admin can
 * reconnect any time. Existing invoice numbers already recorded on requests are
 * untouched — this only forgets the OAuth connection.
 */
export async function disconnectQuickbooksAction(): Promise<IntegrationsActionResult> {
  await requireAdmin();
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("quickbooks_connection")
      .delete()
      .eq("id", true);
    if (error) return { error: error.message };
  } catch {
    return {
      error:
        "Server is missing its service-role key, so QuickBooks could not be disconnected.",
    };
  }
  revalidatePath("/admin/integrations");
  return { ok: true };
}

/**
 * Disconnect Google Calendar: forget the stored (encrypted) refresh token and
 * mark the shared credential disconnected. The admin can reconnect any time.
 * Best-effort — never throws into the UI.
 */
export async function disconnectGoogleAction(): Promise<IntegrationsActionResult> {
  const profile = await requireAdmin();
  const res = await disconnectGoogle(profile.id);
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/integrations");
  return { ok: true };
}
