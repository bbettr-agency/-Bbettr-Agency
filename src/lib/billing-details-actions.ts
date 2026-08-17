"use server";

import { revalidatePath } from "next/cache";
import { requireClient, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  normaliseBillingInput,
  validateBillingDraft,
  type BillingDetailsInput,
  type BillingValidation,
} from "@/lib/billing-details";

export interface BillingSaveResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: BillingValidation["errors"];
}

/**
 * Client self-service upsert of THEIR OWN billing profile. PARTIAL saves are
 * allowed (draft = permissive) — only supplied values are validated for
 * format/length. Completeness (invoice_name + effective email) is enforced later,
 * only at the onboarding submit gate. The client_id is derived from the session
 * (current_client_id via requireClient) — NEVER from the browser. Writes go under
 * the client's own-row RLS (no service-role). updated_by is the acting client's
 * profile id (profiles.id = auth uid → valid FK).
 */
export async function saveMyBillingDetailsAction(
  input: BillingDetailsInput
): Promise<BillingSaveResult> {
  const profile = await requireClient();
  const clientId = profile.client_id;

  const v = validateBillingDraft(input);
  if (!v.ok) return { error: "Please fix the highlighted fields.", fieldErrors: v.errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_billing_details")
    .upsert(
      { client_id: clientId, ...normaliseBillingInput(input), updated_by: profile.id },
      { onConflict: "client_id" }
    );
  if (error) return { error: "Could not save your billing details. Please try again." };

  revalidatePath("/dashboard/onboarding");
  return { ok: true };
}

/**
 * Admin upsert of a selected client's billing profile. Admin RLS (FOR ALL).
 * PARTIAL saves are allowed (draft = permissive), same as the client path —
 * an admin may record just a VAT number today and add the rest later.
 * updated_by is the acting admin's profile id.
 */
export async function adminSaveBillingDetailsAction(
  clientId: string,
  input: BillingDetailsInput
): Promise<BillingSaveResult> {
  const admin = await requireAdmin();

  const v = validateBillingDraft(input);
  if (!v.ok) return { error: "Please fix the highlighted fields.", fieldErrors: v.errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_billing_details")
    .upsert(
      { client_id: clientId, ...normaliseBillingInput(input), updated_by: admin.id },
      { onConflict: "client_id" }
    );
  if (error) return { error: "Could not save billing details. Please try again." };

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}
