"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SERVICES } from "@/lib/services";
import type { ServiceType } from "@/lib/database.types";

export interface OnboardingState {
  ok?: boolean;
  error?: string;
}

/**
 * Persist a service's onboarding submission. `submit=true` finalises it
 * (status -> submitted), otherwise it's saved as a draft (in_progress).
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

  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard");
  return { ok: true };
}
