"use server";

import { getCurrentProfile } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { categoryLabel } from "@/lib/assets";

/**
 * Record a file upload on the client's activity timeline. Best-effort: verifies
 * the caller is the owning client or an admin, then appends a client-visible
 * event. Never throws — a logging failure must not affect the upload.
 */
export async function recordFileUploadActivity(
  clientId: string,
  fileName: string,
  assetCategory: string
): Promise<void> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return;
    if (profile.role !== "admin" && profile.client_id !== clientId) return;

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
