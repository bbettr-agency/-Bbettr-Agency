import { createAdminClient } from "@/lib/supabase/admin";
import {
  getQboConfig,
  QBO_AUTHORIZE_URL,
  QBO_SCOPE,
} from "./config";
import {
  exchangeAndStore,
  getActiveConnection,
  getConnectionStatus,
} from "./connection";
import { createInvoice, findOrCreateCustomer } from "./api";

/**
 * Public QuickBooks surface used by the rest of the app. The OAuth callback
 * route and admin actions only import from here.
 */

export { getConnectionStatus, exchangeAndStore };
export type { QboConnectionStatus } from "./connection";

/** Is QuickBooks configured (env vars present) on this server? */
export function isQboConfigured(): boolean {
  return getQboConfig() !== null;
}

/**
 * Build the Intuit consent URL. `state` is an opaque CSRF token the caller
 * stores (cookie) and re-checks in the callback.
 */
export function getAuthorizeUrl(state: string): string | null {
  const cfg = getQboConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

export interface InvoiceCreationResult {
  ok: boolean;
  invoiceNumber?: string | null;
  invoiceId?: string;
  error?: string;
}

/**
 * Create a QuickBooks invoice for an approved invoice request and record the
 * result on the request + its deal. Idempotent: a request that already has a
 * QBO invoice is treated as success.
 *
 * Best-effort by contract — it returns an error result rather than throwing, so
 * the caller (the approval action / retry) can surface it without ever undoing
 * the approval or the recorded commission.
 */
export async function createInvoiceForRequest(
  requestId: string
): Promise<InvoiceCreationResult> {
  const admin = createAdminClient();

  const { data: req } = await admin
    .from("invoice_requests")
    .select(
      "id, deal_id, amount, quickbooks_invoice_id, quickbooks_invoice_number, deals(business_name, email, package, quickbooks_customer_id)"
    )
    .eq("id", requestId)
    .maybeSingle();

  if (!req) return { ok: false, error: "Invoice request not found." };
  if (req.quickbooks_invoice_id) {
    return {
      ok: true,
      invoiceId: req.quickbooks_invoice_id,
      invoiceNumber: req.quickbooks_invoice_number,
    };
  }

  const deal = (req.deals ?? null) as {
    business_name: string;
    email: string | null;
    package: string | null;
    quickbooks_customer_id: string | null;
  } | null;
  if (!deal) return { ok: false, error: "Deal not found for this request." };

  try {
    const conn = await getActiveConnection();

    // Reuse the deal's stored QBO customer if we have one, else find-or-create.
    const customerId =
      deal.quickbooks_customer_id ||
      (await findOrCreateCustomer(conn, {
        displayName: deal.business_name,
        email: deal.email,
      }));

    const invoice = await createInvoice(conn, {
      customerId,
      amount: Number(req.amount),
      description: deal.package,
      email: deal.email,
    });

    await admin
      .from("invoice_requests")
      .update({
        status: "invoiced",
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_number: invoice.docNumber,
        quickbooks_customer_id: customerId,
        invoiced_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", requestId);

    await admin
      .from("deals")
      .update({ status: "invoiced", quickbooks_customer_id: customerId })
      .eq("id", req.deal_id);

    return { ok: true, invoiceId: invoice.id, invoiceNumber: invoice.docNumber };
  } catch (e) {
    const error = e instanceof Error ? e.message : "QuickBooks invoicing failed.";
    // Record the failure for admin visibility + retry; approval stays intact.
    await admin
      .from("invoice_requests")
      .update({ error })
      .eq("id", requestId);
    return { ok: false, error };
  }
}
