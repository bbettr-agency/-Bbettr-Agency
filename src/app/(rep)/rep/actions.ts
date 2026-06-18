"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRep, isRepActive } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/internal-notifications";
import { sendInvoiceRequestEmail } from "@/lib/email/rep-notifications";
import {
  isValidPackageKey,
  getPackage,
  resolvePackage,
  WEBSITE_SEO_RETAINER,
} from "@/lib/packages";
import type { ClientLocation, Currency } from "@/lib/database.types";

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

  // Currency is the rep's explicit Pricing Type choice (Local = ZAR,
  // International = USD) — NOT derived from client location. It carries through
  // to the QuickBooks invoice.
  const currency: Currency =
    String(formData.get("pricing_type") ?? "local") === "international"
      ? "USD"
      : "ZAR";

  // Client location must be one of the two controlled values. It only routes the
  // payment method later (SA = EFT, International = payment link) — never currency.
  const location = String(
    formData.get("client_location") ?? ""
  ) as ClientLocation;
  if (location !== "south_africa" && location !== "international") {
    return { error: "Please choose a client location." };
  }

  const text = (k: string) => String(formData.get(k) ?? "").trim() || null;

  // Structured service package — must be one of the approved catalogue services.
  // The name + description (and billing type) come from the catalogue, so reps
  // never type them and the invoice stays consistent.
  const packageKey = String(formData.get("package_key") ?? "").trim();
  const pkg = getPackage(packageKey);
  if (!isValidPackageKey(packageKey) || !pkg) {
    return { error: "Please choose a service." };
  }
  const billing = pkg.billing;
  const resolved = resolvePackage({ packageKey });

  // Optional monthly retainer — the single approved Website Maintenance & SEO
  // Retainer. Its name + description are applied server-side (the rep enters only
  // the amount); it becomes a separate invoice line and is NOT commissioned.
  const hasRetainer =
    String(formData.get("has_monthly_retainer") ?? "") === "on";
  const retainerName = hasRetainer ? WEBSITE_SEO_RETAINER.name : null;
  const retainerDescription = hasRetainer ? WEBSITE_SEO_RETAINER.description : null;
  const retainerRaw = formData.get("monthly_retainer_amount");
  const retainerAmount =
    retainerRaw !== null && String(retainerRaw) !== ""
      ? Number(retainerRaw)
      : null;
  if (hasRetainer) {
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
      custom_package_name: null,
      custom_package_description: null,
      has_monthly_retainer: hasRetainer,
      monthly_retainer_name: retainerName,
      monthly_retainer_description: retainerDescription,
      monthly_retainer_amount: hasRetainer ? retainerAmount : null,
      price,
      billing_type: billing,
      client_location: location,
      currency,
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
