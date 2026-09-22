"use server";

import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { categoryLabel } from "@/lib/assets";

/**
 * Record a file upload on the client's activity timeline. Best-effort: verifies
 * the caller is an admin OR a genuine MEMBER of `clientId` (multi-workspace:
 * checked against client_members, not the legacy profiles.client_id, so a member
 * of a non-default workspace is authorized here too), then appends a client-
 * visible event. logActivity writes with the service role (bypasses RLS), so
 * this membership check is the authoritative gate — it fails closed on a non-
 * member. Never throws — a logging failure must not affect the upload.
 */
export async function recordFileUploadActivity(
  clientId: string,
  fileName: string,
  assetCategory: string
): Promise<void> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return;
    if (profile.role !== "admin") {
      // Membership check under the caller's RLS: client_members returns only the
      // user's own rows, so a row exists here iff they belong to `clientId`.
      const supabase = await createClient();
      const { data: membership } = await supabase
        .from("client_members")
        .select("client_id")
        .eq("client_id", clientId)
        .maybeSingle();
      if (!membership) return;
    }

    await logActivity({
      clientId,
      type: "file_uploaded",
      title: `File uploaded: ${fileName}`,
      description: `Added to ${categoryLabel(assetCategory)}.`,
      visibility: "client",
    });
  } catch {
    // non-critical
  }
}
