"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { dismissSubmittedIntake } from "@/lib/prospect/intake-admin";

export type DismissResult = { ok: true } | { ok: false; error: string };

/**
 * Dismiss a submitted prospect intake (admin-only, P3-A). `requireAdmin()`
 * redirects non-admins before any work; RLS enforces admin at the DB regardless.
 * The transition is guarded to submitted→dismissed and never deletes the row.
 */
export async function dismissProspectIntakeAction(id: string): Promise<DismissResult> {
  await requireAdmin();
  if (typeof id !== "string" || id.length === 0) return { ok: false, error: "invalid" };
  try {
    const done = await dismissSubmittedIntake(id);
    if (!done) return { ok: false, error: "not_submitted" }; // already dismissed/converted/missing
    revalidatePath("/admin/intakes");
    revalidatePath(`/admin/intakes/${id}`);
    return { ok: true };
  } catch {
    console.error("[intake] dismiss failed"); // no PII/ids in the log line
    return { ok: false, error: "failed" };
  }
}
