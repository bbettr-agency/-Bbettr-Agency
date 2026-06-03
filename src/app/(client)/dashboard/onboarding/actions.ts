"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SERVICES } from "@/lib/services";
import type { ServiceType } from "@/lib/database.types";

export interface OnboardingState {
  ok?: boolean;
  error?: string;
  /** The next service that still needs onboarding, for auto-navigation. */
  nextService?: ServiceType | null;
  /** True when every purchased service has been submitted/approved. */
  allComplete?: boolean;
}

const isDone = (status: string) =>
  status === "submitted" || status === "approved";

/**
 * Persist a service's onboarding submission. `submit=true` finalises it
 * (status -> submitted), otherwise it's saved as a draft (in_progress).
 *
 * On finalise this also advances the project roadmap and the client's overall
 * status once ALL purchased services have been submitted, and returns the next
 * incomplete service so the UI can move the client straight to it.
 */
export async function saveOnboarding(
  service: ServiceType,
  data: Record<string, unknown>,
  submit: boolean
): Promise<OnboardingState> {
  const profile = await requireClient();
  if (!SERVICES[service]) return { error: "Unknown service." };

  const supabase = await createClient();
  const status = submit ? "submitted" : "in_progress";

  const { error } = await supabase
    .from("onboarding_submissions")
    .upsert(
      {
        client_id: profile.client_id,
        service,
        data,
        status,
        submitted_at: submit ? new Date().toISOString() : null,
      },
      { onConflict: "client_id,service" }
    );

  if (error) return { error: "Could not save your onboarding. Please try again." };

  // Keep the client_services status in sync.
  await supabase
    .from("client_services")
    .update({ onboarding_status: status })
    .eq("client_id", profile.client_id)
    .eq("service", service);

  // A draft save only needs the onboarding view refreshed.
  if (!submit) {
    revalidatePath("/dashboard/onboarding");
    return { ok: true };
  }

  // ── Finalise: recompute completion from authoritative DB state ──────────
  const { data: services } = await supabase
    .from("client_services")
    .select("service, onboarding_status, created_at")
    .eq("client_id", profile.client_id)
    .order("created_at");

  const list = services ?? [];
  const next = list.find((s) => !isDone(s.onboarding_status));
  const allComplete = list.length > 0 && list.every((s) => isDone(s.onboarding_status));

  if (allComplete) {
    // Advance the onboarding-related roadmap stages.
    await supabase
      .from("project_stages")
      .update({ status: "completed" })
      .eq("client_id", profile.client_id)
      .in("name", ["Contract Signed", "Onboarding Submitted"]);

    // Kick off the next stage if it is still pending.
    await supabase
      .from("project_stages")
      .update({ status: "in_progress" })
      .eq("client_id", profile.client_id)
      .eq("name", "Assets Received")
      .eq("status", "pending");

    // Move the client out of the onboarding phase into active delivery.
    await supabase
      .from("clients")
      .update({ status: "in_progress" })
      .eq("id", profile.client_id)
      .eq("status", "onboarding");
  }

  // Refresh every surface that reflects this change (client + admin).
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/project");
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${profile.client_id}`);

  return { ok: true, nextService: next?.service ?? null, allComplete };
}
