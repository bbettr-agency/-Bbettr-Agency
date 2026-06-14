import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPayfastConfig,
  isPayfastConfigured,
  payfastProcessUrl,
} from "./config";
import { payfastSignature } from "./signature";

/**
 * Public PayFast surface. International-only: a PayFast link is generated for a
 * deal whose `client_location = 'international'`. South African deals never get
 * one (they use the QuickBooks invoice + EFT).
 *
 * V1: generate + store + display the link, with a manual admin "Mark as paid".
 * No ITN/webhook yet — link creation is a local signed-URL build + DB write, so
 * it has no external dependency and never affects QuickBooks, commission or
 * approval.
 */

export { isPayfastConfigured };
export { getPayfastDebugInfo, type PayfastDebugInfo } from "./config";

export interface PayfastPaymentResult {
  ok: boolean;
  paymentUrl?: string;
  error?: string;
}

/**
 * Create (or reuse) the PayFast payment for an invoice request. Idempotent: one
 * row per request (UNIQUE invoice_request_id) — a second call returns the
 * existing link rather than creating a duplicate. Only acts on international
 * deals; returns a no-op error otherwise.
 */
export async function createPaymentForRequest(
  requestId: string
): Promise<PayfastPaymentResult> {
  const cfg = getPayfastConfig();
  if (!cfg) return { ok: false, error: "PayFast is not configured on this server." };

  const admin = createAdminClient();

  // Idempotent: reuse an existing payment link if one is already stored.
  const { data: existing } = await admin
    .from("payfast_payments")
    .select("payment_url")
    .eq("invoice_request_id", requestId)
    .maybeSingle();
  if (existing) return { ok: true, paymentUrl: existing.payment_url };

  const { data: req } = await admin
    .from("invoice_requests")
    .select(
      "id, deal_id, amount, deals(business_name, package, client_location, has_monthly_retainer, monthly_retainer_amount)"
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: "Invoice request not found." };

  const deal = (req.deals ?? null) as {
    business_name: string;
    package: string | null;
    client_location: string;
    has_monthly_retainer: boolean | null;
    monthly_retainer_amount: number | null;
  } | null;
  if (!deal) return { ok: false, error: "Deal not found for this request." };

  // International only — never generate a link for South African clients.
  if (deal.client_location !== "international") {
    return { ok: false, error: "PayFast applies to international clients only." };
  }

  // Pay the full invoice total (package + retainer if present) — same as QBO.
  const retainer =
    deal.has_monthly_retainer && deal.monthly_retainer_amount
      ? Number(deal.monthly_retainer_amount)
      : 0;
  const amount = Number(req.amount) + retainer;
  const itemName = `${deal.business_name} — ${deal.package ?? "Bbettr Agency invoice"}`;

  const mPaymentId = requestId;
  const paymentUrl = `${cfg.appUrl}/pay/${mPaymentId}`;

  const { error } = await admin.from("payfast_payments").insert({
    invoice_request_id: requestId,
    deal_id: req.deal_id,
    m_payment_id: mPaymentId,
    amount,
    item_name: itemName.slice(0, 100),
    payment_url: paymentUrl,
    status: "pending",
  });

  if (error) {
    // A concurrent insert may have won the UNIQUE race — reuse it if so.
    const { data: row } = await admin
      .from("payfast_payments")
      .select("payment_url")
      .eq("invoice_request_id", requestId)
      .maybeSingle();
    if (row) return { ok: true, paymentUrl: row.payment_url };
    return { ok: false, error: error.message };
  }

  return { ok: true, paymentUrl };
}

export interface PayfastRedirect {
  actionUrl: string;
  /** Ordered hidden fields (incl. signature) to POST to PayFast. */
  fields: [string, string][];
}

/**
 * Build the signed PayFast form for a stored payment, keyed by m_payment_id.
 * The /pay/[id] route renders these as an auto-submitting form. Returns null if
 * PayFast isn't configured or the payment doesn't exist.
 */
export async function buildPayfastRedirect(
  mPaymentId: string
): Promise<PayfastRedirect | null> {
  const cfg = getPayfastConfig();
  if (!cfg) return null;

  const admin = createAdminClient();
  const { data: pay } = await admin
    .from("payfast_payments")
    .select("m_payment_id, amount, item_name")
    .eq("m_payment_id", mPaymentId)
    .maybeSingle();
  if (!pay) return null;

  // Order matters — the signature is computed over this exact field order.
  const ordered: [string, string][] = [
    ["merchant_id", cfg.merchantId],
    ["merchant_key", cfg.merchantKey],
    ["return_url", `${cfg.appUrl}/pay/return`],
    ["cancel_url", `${cfg.appUrl}/pay/cancel`],
    ["notify_url", `${cfg.appUrl}/api/payfast/notify`],
    ["m_payment_id", pay.m_payment_id],
    ["amount", Number(pay.amount).toFixed(2)],
    ["item_name", pay.item_name],
  ];
  const signature = payfastSignature(ordered, cfg.passphrase);

  return {
    actionUrl: payfastProcessUrl(cfg.environment),
    fields: [...ordered, ["signature", signature]],
  };
}
