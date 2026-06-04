import { revalidatePath } from "next/cache";

/**
 * Revalidate every surface affected by a change to a single client/tenant —
 * BOTH the admin views and the client-facing pages. Centralised so no admin
 * mutation forgets to refresh the client side (which previously caused the
 * client dashboard/progress/updates/reports to show stale data).
 */
export function revalidateClient(clientId: string) {
  // Admin surfaces
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/updates");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/files");

  // Client-facing surfaces
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/project");
  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/updates");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/files");
}
