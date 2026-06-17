import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import type { IntakeStatus } from "@/lib/database.types";

/**
 * Advance a NEW client's intake_status to `target`, but only when it is currently
 * one of `allowedFrom` — so it never moves backwards, never skips ahead, and
 * never touches legacy clients. Optionally records a client-visible activity
 * event.
 *
 * Uses the SERVICE-ROLE client on purpose: clients have no write policy on the
 * `clients` table (a client must never self-advance), and this helper is called
 * from client-session paths (first login, onboarding submit) as well as admin
 * ones. Best-effort — it never throws, so a failure can't break the caller.
 */
export async function advanceIntakeStatus(
  clientId: string,
  target: IntakeStatus,
  allowedFrom: IntakeStatus[],
  activity?: { type: string; title: string; visibility?: "client" | "internal" }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: client } = await admin
      .from("clients")
      .select("onboarding_type, intake_status")
      .eq("id", clientId)
      .maybeSingle();

    if (!client || client.onboarding_type !== "new") return;
    if (!allowedFrom.includes(client.intake_status as IntakeStatus)) return;

    await admin
      .from("clients")
      .update({ intake_status: target })
      .eq("id", clientId);

    if (activity) {
      await logActivity({
        clientId,
        type: activity.type,
        title: activity.title,
        visibility: activity.visibility ?? "client",
      });
    }
  } catch {
    // Best-effort intake instrumentation — never break the calling flow.
  }
}
