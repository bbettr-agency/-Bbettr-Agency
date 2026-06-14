"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRep, isRepActive } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/internal-notifications";
import { sendInvoiceRequestEmail } from "@/lib/email/rep-notifications";
import {
  isValidPackageKey,
  isCustomPackage,
  resolvePackage,
} from "@/lib/packages";
import type { BillingType, ClientLocation } from "@/lib/database.types";

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

  // Client location must be one of the two controlled values. It's stored now
  // and used later to route payments (SA = EFT, International = payment link).
  const location = String(
    formData.get("client_location") ?? ""
  ) as ClientLocation;
  if (location !== "south_africa" && location !== "international") {
    return { error: "Please choose a client location." };
  }

  const text = (k: string) => String(formData.get(k) ?? "").trim() || null;

  // Structured service package — must be a known catalogue key. For the custom
  // package the rep must supply a product/service name and description, which
  // become the QuickBooks line item + description.
  const packageKey = String(formData.get("package_key") ?? "").trim();
  if (!isValidPackageKey(packageKey)) {
    return { error: "Please choose a service package." };
  }
  const customName = text("custom_package_name");
  const customDescription = text("custom_package_description");
  if (isCustomPackage(packageKey) && (!customName || !customDescription)) {
    return {
      error: "Please enter a custom product/service name and description.",
    };
  }
  const resolved = resolvePackage({ packageKey, customName, customDescription });

  // Optional monthly retainer. When enabled, all three fields are required and
  // the amount must be > 0. It becomes a second invoice line (not commissioned).
  const hasRetainer =
    String(formData.get("has_monthly_retainer") ?? "") === "on";
  const retainerName = text("monthly_retainer_name");
  const retainerDescription = text("monthly_retainer_description");
  const retainerRaw = formData.get("monthly_retainer_amount");
  const retainerAmount =
    retainerRaw !== null && String(retainerRaw) !== ""
      ? Number(retainerRaw)
      : null;
  if (hasRetainer) {
    if (!retainerName || !retainerDescription) {
      return {
        error:
          "Please enter the monthly retainer product/service and description.",
      };
    }
    if (
      retainerAmount === null ||
      !Number.isFinite(retainerAmount) ||
      retainerAmount <= 0
    ) {
      return { error: "Monthly retainer amount must be greater than zero." };
    }
  }

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      rep_id: profile.id,
      business_name: businessName,
      contact_name: text("contact_name"),
      email: text("email"),
      phone: text("phone"),
      package: resolved.label,
      package_key: packageKey,
      custom_package_name: isCustomPackage(packageKey) ? customName : null,
      custom_package_description: isCustomPackage(packageKey)
        ? customDescription
        : null,
      has_monthly_retainer: hasRetainer,
      monthly_retainer_name: hasRetainer ? retainerName : null,
      monthly_retainer_description: hasRetainer ? retainerDescription : null,
      monthly_retainer_amount: hasRetainer ? retainerAmount : null,
      price,
      billing_type: billing,
      client_location: location,
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
    packageName: resolved.label,
    amount: price,
    billingType: billing,
    location,
  });

  revalidatePath("/rep");
  revalidatePath("/admin/invoices");
  // Refresh the admin layout so the notification bell's unread badge updates.
  revalidatePath("/admin", "layout");
  redirect("/rep?created=1");
}
