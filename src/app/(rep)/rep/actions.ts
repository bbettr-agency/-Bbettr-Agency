"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRep } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BillingType } from "@/lib/database.types";

export interface DealActionResult {
  error?: string;
}

/**
 * Rep closes a deal: creates the deal and raises an invoice request (pending)
 * for admin approval. The invoice is NOT created here — that happens after an
 * admin approves (and, in the QuickBooks phase, is sent to QBO).
 *
 * Runs under the rep's RLS (rep_id = auth.uid()), so a rep can only ever create
 * their own deals/requests.
 */
export async function createDealAction(
  formData: FormData
): Promise<DealActionResult> {
  const profile = await requireRep();
  const supabase = await createClient();

  const businessName = String(formData.get("business_name") ?? "").trim();
  if (!businessName) return { error: "Business name is required." };

  const priceRaw = formData.get("price");
  const price =
    priceRaw !== null && String(priceRaw) !== "" ? Number(priceRaw) : null;
  if (price !== null && !Number.isFinite(price)) {
    return { error: "Price must be a valid number." };
  }

  const billing = String(formData.get("billing_type") ?? "once_off") as BillingType;
  const text = (k: string) => String(formData.get(k) ?? "").trim() || null;

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      rep_id: profile.id,
      business_name: businessName,
      contact_name: text("contact_name"),
      email: text("email"),
      phone: text("phone"),
      package: text("package"),
      price,
      billing_type: billing,
      notes: text("notes"),
      status: "invoice_requested",
    })
    .select("id")
    .single();

  if (error || !deal) {
    return { error: error?.message ?? "Could not create the deal." };
  }

  const { error: requestError } = await supabase
    .from("invoice_requests")
    .insert({
      deal_id: deal.id,
      rep_id: profile.id,
      amount: price ?? 0,
      billing_type: billing,
      status: "pending",
    });
  if (requestError) return { error: requestError.message };

  revalidatePath("/rep");
  revalidatePath("/admin/invoices");
  redirect("/rep?created=1");
}
