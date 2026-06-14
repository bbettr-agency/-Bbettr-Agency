import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import { getPayfastConfig, payfastValidateUrl } from "./config";

type PayfastUpdate = Database["public"]["Tables"]["payfast_payments"]["Update"];

/**
 * PayFast ITN (Instant Transaction Notification) verification + processing.
 *
 * Security model (all must pass before any "paid" write):
 *   1. Signature — recompute the MD5 over the posted fields (in posted order,
 *      excluding `signature`) + passphrase and compare.
 *   2. Source authenticity — server-to-server postback of the raw body to
 *      PayFast's /eng/query/validate; expect "VALID". Defeats forged POSTs.
 *   3. merchant_id matches our configured merchant.
 *   4. amount_gross matches the stored amount (R0.01 tolerance).
 *   + payment_status drives the state change (COMPLETE → paid).
 *
 * Idempotent and tamper-resistant: a `paid` row is final — re-deliveries and any
 * later (esp. invalid) notifications are acknowledged but never mutate it.
 * Writes go through the service-role client. Nothing here touches QuickBooks,
 * commission, the approval flow or the SA/EFT path.
 *
 * NOTE: the ITN signature is computed differently from the V1 *generation*
 * signature — it includes ALL posted fields (even empty) in posted order and
 * does NOT trim values. So we deliberately do not reuse payfastSignature() here.
 */

/** PHP urlencode-compatible encoder for ITN signing (no trimming of values). */
function encodeItn(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Recompute the ITN signature over the posted fields (excluding `signature`). */
function computeItnSignature(
  orderedExclSignature: [string, string][],
  passphrase: string
): string {
  const parts = orderedExclSignature.map(([k, v]) => `${k}=${encodeItn(v)}`);
  let str = parts.join("&");
  if (passphrase) str += `&passphrase=${encodeItn(passphrase.trim())}`;
  return createHash("md5").update(str).digest("hex");
}

/** Server-to-server check that the ITN genuinely originated from PayFast. */
async function validateWithPayfast(
  rawBody: string,
  env: "live" | "sandbox"
): Promise<boolean> {
  try {
    const res = await fetch(payfastValidateUrl(env), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const text = (await res.text()).trim().toUpperCase();
    return text.startsWith("VALID");
  } catch {
    // Network failure → treat as not validated; the ITN is rejected (logged),
    // PayFast will retry, and manual Mark Paid remains as the fallback.
    return false;
  }
}

export interface ItnResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify and process a raw ITN body. Always returns (never throws) so the route
 * can acknowledge with 200 regardless. Only mutates a matching payfast_payments
 * row, and only flips it to paid when every check passes.
 */
export async function processItn(rawBody: string): Promise<ItnResult> {
  const cfg = getPayfastConfig();
  if (!cfg) return { ok: false, reason: "PayFast not configured" };

  const params = new URLSearchParams(rawBody);
  const posted: [string, string][] = [...params.entries()];
  const data = Object.fromEntries(posted) as Record<string, string>;

  const mPaymentId = data["m_payment_id"];
  if (!mPaymentId) return { ok: false, reason: "missing m_payment_id" };

  const admin = createAdminClient();
  const { data: pay } = await admin
    .from("payfast_payments")
    .select("id, status, amount")
    .eq("m_payment_id", mPaymentId)
    .maybeSingle();

  // Unknown reference → no-op (don't leak existence, don't create rows).
  if (!pay) return { ok: false, reason: "no matching payment" };

  // A paid row is final: idempotent no-op for re-deliveries, and prevents a
  // later invalid ITN from churning the audit on a settled payment.
  if (pay.status === "paid") return { ok: true, reason: "already paid (no-op)" };

  // ── Verification ────────────────────────────────────────────────────────
  const errors: string[] = [];

  const postedSignature = (data["signature"] ?? "").toLowerCase();
  const expectedSignature = computeItnSignature(
    posted.filter(([k]) => k !== "signature"),
    cfg.passphrase
  );
  if (!postedSignature || postedSignature !== expectedSignature) {
    errors.push("signature mismatch");
  }

  if (data["merchant_id"] !== cfg.merchantId) {
    errors.push("merchant_id mismatch");
  }

  const amountGross = Number(data["amount_gross"]);
  if (
    !Number.isFinite(amountGross) ||
    Math.abs(amountGross - Number(pay.amount)) > 0.01
  ) {
    errors.push("amount mismatch");
  }

  // Only worth the network round-trip once the cheap local checks pass.
  if (errors.length === 0) {
    const valid = await validateWithPayfast(rawBody, cfg.environment);
    if (!valid) errors.push("validate postback not VALID");
  }

  const valid = errors.length === 0;
  const pfStatus = (data["payment_status"] ?? "").toUpperCase();

  // ── Audit + (maybe) status update ───────────────────────────────────────
  const update: PayfastUpdate = {
    raw_itn: data,
    itn_received_at: new Date().toISOString(),
    itn_valid: valid,
    itn_error: valid ? null : errors.join("; "),
    pf_payment_status: data["payment_status"] ?? null,
    amount_gross: Number.isFinite(amountGross) ? amountGross : null,
    pf_payment_id: data["pf_payment_id"] ?? null,
    updated_at: new Date().toISOString(),
  };

  if (valid) {
    if (pfStatus === "COMPLETE") {
      update.status = "paid";
      update.paid_at = new Date().toISOString();
      update.marked_paid_by = null; // system-confirmed (vs. admin manual)
    } else if (pfStatus === "CANCELLED") {
      update.status = "cancelled";
    } else if (pfStatus === "FAILED") {
      update.status = "failed";
    }
    // Unknown/intermediate statuses → audit only, no status change.
  }

  await admin
    .from("payfast_payments")
    .update(update)
    .eq("m_payment_id", mPaymentId);

  return { ok: valid, reason: valid ? undefined : errors.join("; ") };
}
