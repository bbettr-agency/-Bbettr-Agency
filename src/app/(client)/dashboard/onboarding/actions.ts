"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { advanceIntakeStatus } from "@/lib/intake-advance";
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
 * IMPORTANT — why we use the service-role client for the side-effects:
 * Clients only have RLS write access to `onboarding_submissions` (their own
 * data). They intentionally have NO write policy on `client_services`,
 * `project_stages` or `clients` — a client must never be able to self-advance
 * their project or change their account status via the API. So those derived
 * updates are performed here with the service-role client, scoped strictly to
 * the authenticated client's own `client_id` (from the session, never from
 * user input). Without this, the updates were silently filtered to 0 rows by
 * RLS and nothing appeared to save.
 */
export async function saveOnboarding(
  service: ServiceType,
  data: Record<string, unknown>,
  submit: boolean
): Promise<OnboardingState> {
  const profile = await requireClient();
  if (!SERVICES[service]) return { error: "Unknown service." };

  const clientId = profile.client_id;
  const supabase = await createClient();
  const status = submit ? "submitted" : "in_progress";

  // 1. The submission itself is the client's own data → write under their RLS.
  const { error: submissionError } = await supabase
    .from("onboarding_submissions")
    .upsert(
      {
        client_id: clientId,
        service,
        data,
        status,
        submitted_at: submit ? new Date().toISOString() : null,
      },
      { onConflict: "client_id,service" }
    );

  if (submissionError) {
    return { error: "Could not save your onboarding. Please try again." };
  }

  // 2. Everything below is a privileged, derived write that RLS blocks for
  //    clients — perform it with the service-role client, scoped to this tenant.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so your status could not be updated. Please contact support.",
    };
  }

  // Keep the service's onboarding status in sync.
  const { error: serviceError } = await admin
    .from("client_services")
    .update({ onboarding_status: status })
    .eq("client_id", clientId)
    .eq("service", service);

  if (serviceError) {
    return { error: "Could not update your onboarding status. Please try again." };
  }

  // A draft save only needs the onboarding view refreshed.
  if (!submit) {
    revalidatePath("/dashboard/onboarding");
    revalidatePath("/dashboard");
    return { ok: true };
  }

  // ── Finalise: recompute completion from authoritative DB state ──────────
  const { data: services } = await admin
    .from("client_services")
    .select("service, onboarding_status, created_at")
    .eq("client_id", clientId)
    .order("created_at");

  const list = services ?? [];
  const next = list.find((s) => !isDone(s.onboarding_status));
  const allComplete =
    list.length > 0 && list.every((s) => isDone(s.onboarding_status));

  if (allComplete) {
    // Advance the onboarding-related roadmap stages.
    await admin
      .from("project_stages")
      .update({ status: "completed" })
      .eq("client_id", clientId)
      .in("name", ["Contract Signed", "Onboarding Submitted"]);

    // Kick off the next stage if it is still pending.
    await admin
      .from("project_stages")
      .update({ status: "in_progress" })
      .eq("client_id", clientId)
      .eq("name", "Assets Received")
      .eq("status", "pending");

    // Move the client out of the onboarding phase into active delivery.
    await admin
      .from("clients")
      .update({ status: "in_progress" })
      .eq("id", clientId)
      .eq("status", "onboarding");

    // D1: advance the intake pipeline for new clients (best-effort, new-only).
    await advanceIntakeStatus(clientId, "onboarding_submitted", ["onboarding_started"], {
      type: "onboarding_submitted",
      title: "Onboarding submitted",
    });
  }

  // Refresh every surface that reflects this change (client + admin).
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/project");
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);

  return { ok: true, nextService: next?.service ?? null, allComplete };
}
