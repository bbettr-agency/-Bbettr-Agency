"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRep, isRepActive } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/internal-notifications";
import { sendInvoiceRequestEmail } from "@/lib/email/rep-notifications";
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

  // A deactivated rep must not be able to submit deals (this action runs outside
  // the layout that gates the UI).
  if (!(await isRepActive(profile.id))) {
    return { error: "Your rep account is deactivated. Contact your administrator." };
  }

  const supabase = await createClient();

  const businessName = String(formData.get("business_name") ?? "").trim();
  if (!businessName) return { error: "Business name is required." };

  const priceRaw = formData.get("price");
  const price =
    priceRaw !== null && String(priceRaw) !== "" ? Number(priceRaw) : null;
  // Price drives the invoice request and the rep's commission, so it must be a
  // positive amount — not blank, zero or negative.
  if (price === null) return { error: "Price is required." };
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Price must be greater than zero." };
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
      amount: price,
      billing_type: billing,
      status: "pending",
    });
  if (requestError) {
    // The invoice request is the whole point of submitting a deal — if it fails,
    // remove the just-created deal so we don't leave an orphan with no request.
    await supabase.from("deals").delete().eq("id", deal.id);
    return { error: requestError.message };
  }

  // Notify admins that a new deal / invoice request needs review (in-app bell).
  await notifyAdmins({
    type: "deal_submitted",
    title: `New deal submitted — ${businessName}`,
    body: `${profile.full_name ?? "A rep"} submitted a deal${
      price ? ` worth R${price.toLocaleString("en-ZA")}` : ""
    }.`,
    link: "/admin/invoices",
  });

  // Email the agency inbox with the full deal details (best-effort).
  await sendInvoiceRequestEmail({
    repName: profile.full_name ?? "A rep",
    businessName,
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    packageName: text("package"),
    amount: price,
    billingType: billing,
  });

  revalidatePath("/rep");
  revalidatePath("/admin/invoices");
  // Refresh the admin layout so the notification bell's unread badge updates.
  revalidatePath("/admin", "layout");
  redirect("/rep?created=1");
}
