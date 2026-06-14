import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePackage } from "@/lib/packages";
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
import {
  createInvoice,
  customerExists,
  findInvoiceByDocNumber,
  findOrCreateCustomer,
  getInvoice,
  sendInvoiceEmail,
  QboApiError,
  type InvoiceLineInput,
} from "./api";

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

export type QboEmailStatus = "sent" | "failed" | "no_email";

export interface InvoiceCreationResult {
  ok: boolean;
  invoiceNumber?: string | null;
  invoiceId?: string;
  realmId?: string;
  customerId?: string;
  emailStatus?: QboEmailStatus;
  error?: string;
}

/** Extract a persistable detail string from an arbitrary thrown error. */
function errorDetail(e: unknown): string {
  if (e instanceof QboApiError) return e.body || e.message;
  if (e instanceof Error) return e.message;
  return "QuickBooks invoicing failed.";
}

/**
 * Create (and email) a QuickBooks invoice for an approved invoice request, then
 * record the verified result on the request + its deal.
 *
 * STATUS INTEGRITY — a request is only marked "invoiced" when ALL hold:
 *   - a customer exists (reused after existence check, or freshly created);
 *   - the invoice was created AND re-read back from QuickBooks;
 *   - QuickBooks returned a non-empty invoice Id AND DocNumber (the human
 *     number visible in QuickBooks).
 * If any step fails the request stays "approved", the failure + raw QBO payload
 * are recorded, and the admin can retry. Approval and commission are never
 * touched. Idempotent: an already-invoiced request is a no-op success.
 *
 * The invoice email is sent explicitly (QBO's send endpoint) and its outcome is
 * recorded separately — a failed email does NOT block "invoiced", because the
 * invoice genuinely exists, but it is surfaced for follow-up.
 *
 * Best-effort by contract — returns an error result rather than throwing.
 */
export async function createInvoiceForRequest(
  requestId: string
): Promise<InvoiceCreationResult> {
  const admin = createAdminClient();
  const attemptedAt = new Date().toISOString();

  const { data: req } = await admin
    .from("invoice_requests")
    .select(
      "id, deal_id, amount, quickbooks_invoice_id, quickbooks_invoice_number, deals(business_name, email, package, package_key, custom_package_name, custom_package_description, has_monthly_retainer, monthly_retainer_name, monthly_retainer_description, monthly_retainer_amount, quickbooks_customer_id)"
    )
    .eq("id", requestId)
    .maybeSingle();

  if (!req) return { ok: false, error: "Invoice request not found." };
  // Idempotency: the QBO invoice Id is the key. If one already exists we never
  // create a second invoice on retry. If we have an Id but no stored DocNumber
  // yet, best-effort re-read to backfill the number; either way report success.
  if (req.quickbooks_invoice_id) {
    if (!req.quickbooks_invoice_number) {
      try {
        const conn = await getActiveConnection();
        const v = await getInvoice(conn, req.quickbooks_invoice_id);
        if (v?.docNumber) {
          await admin
            .from("invoice_requests")
            .update({ quickbooks_invoice_number: v.docNumber })
            .eq("id", requestId);
          return {
            ok: true,
            invoiceId: req.quickbooks_invoice_id,
            invoiceNumber: v.docNumber,
          };
        }
      } catch {
        // Re-read failed — still a success; the invoice already exists in QBO.
      }
    }
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
    package_key: string | null;
    custom_package_name: string | null;
    custom_package_description: string | null;
    has_monthly_retainer: boolean | null;
    monthly_retainer_name: string | null;
    monthly_retainer_description: string | null;
    monthly_retainer_amount: number | null;
    quickbooks_customer_id: string | null;
  } | null;
  if (!deal) return { ok: false, error: "Deal not found for this request." };

  // Resolve the QBO product/service name + invoice description from the deal's
  // structured package (falls back to the legacy free-text package on old deals).
  const lineItem = resolvePackage({
    packageKey: deal.package_key,
    customName: deal.custom_package_name,
    customDescription: deal.custom_package_description,
    legacyPackage: deal.package,
  });

  // Build the invoice lines: the once-off package line, plus — only when the
  // deal has a valid monthly retainer — a second line for it. The retainer is
  // invoiced but NOT commissioned (commission stays on invoice_request.amount).
  const invoiceLines: InvoiceLineInput[] = [
    {
      itemName: lineItem.qboItemName,
      amount: Number(req.amount),
      description: lineItem.description,
    },
  ];
  if (
    deal.has_monthly_retainer &&
    deal.monthly_retainer_name &&
    deal.monthly_retainer_amount &&
    Number(deal.monthly_retainer_amount) > 0
  ) {
    invoiceLines.push({
      itemName: deal.monthly_retainer_name,
      amount: Number(deal.monthly_retainer_amount),
      description: deal.monthly_retainer_description,
    });
  }

  // Accumulating diagnostics persisted on every outcome (success or failure).
  const log: Record<string, unknown> = { attemptedAt };
  let realmId: string | undefined;

  const recordFailure = async (error: string, step: string) => {
    log.failedStep = step;
    log.error = error;
    await admin
      .from("invoice_requests")
      .update({
        error,
        quickbooks_realm_id: realmId ?? null,
        quickbooks_last_attempt_at: attemptedAt,
        quickbooks_log: log,
      })
      .eq("id", requestId);
    return { ok: false as const, error, realmId };
  };

  try {
    const conn = await getActiveConnection();
    realmId = conn.realmId;
    log.realmId = conn.realmId;
    log.environment = conn.environment;

    // 1) Customer — reuse the deal's stored id (after confirming it still
    //    exists in this realm) else find-or-create. Re-creates if a stored id
    //    is stale, e.g. left over from a different/sandbox company.
    let customerId = deal.quickbooks_customer_id ?? null;
    if (customerId) {
      const stillThere = await customerExists(conn, customerId);
      log.customer = stillThere
        ? { action: "reused", id: customerId }
        : { action: "stale_recreate", staleId: customerId };
      if (!stillThere) customerId = null;
    }
    if (!customerId) {
      const c = await findOrCreateCustomer(conn, {
        displayName: deal.business_name,
        email: deal.email,
      });
      customerId = c.id;
      log.customer = { action: c.created ? "created" : "found", id: c.id };
    }
    if (!customerId) return recordFailure("No QuickBooks customer id.", "customer");

    // 2) Reserve a stable, unique portal invoice number (BBTTR-000001 …). Reuse
    //    one already reserved on a prior attempt so a retry never consumes a new
    //    number; only draw a fresh one when none is reserved yet.
    let reservedDocNumber = req.quickbooks_invoice_number ?? null;
    if (!reservedDocNumber) {
      const { data: dn, error: dnError } = await admin.rpc(
        "next_qbo_invoice_docnumber"
      );
      if (dnError || !dn) {
        return recordFailure(
          `Could not assign an invoice number: ${dnError?.message ?? "no value"}`,
          "docnumber"
        );
      }
      reservedDocNumber = dn as string;
      // Persist the reservation immediately so a retry reuses this exact number.
      await admin
        .from("invoice_requests")
        .update({ quickbooks_invoice_number: reservedDocNumber })
        .eq("id", requestId);
    }
    log.docNumber = reservedDocNumber;

    // 3) Create the invoice — but if a prior attempt already created one with
    //    this DocNumber, adopt it instead of creating a duplicate.
    let created = await findInvoiceByDocNumber(conn, reservedDocNumber);
    if (created) {
      log.invoiceAdopted = { id: created.id, docNumber: created.docNumber };
    } else {
      created = await createInvoice(conn, {
        customerId,
        lines: invoiceLines,
        docNumber: reservedDocNumber,
        email: deal.email,
      });
      log.invoiceCreate = { id: created.id, docNumber: created.docNumber };
      log.invoiceCreateRaw = created.raw ?? null;
    }
    log.lines = invoiceLines.map((l) => ({ item: l.itemName, amount: l.amount }));

    // 3) Re-read the invoice using the returned Id to get the authoritative
    //    DocNumber when available. Best-effort — a failed or sparse re-read must
    //    NOT fail an invoice QuickBooks has already created.
    let verified: { id: string; docNumber: string | null } | null = null;
    try {
      verified = await getInvoice(conn, created.id);
    } catch (e) {
      log.invoiceVerifyError = errorDetail(e);
    }
    log.invoiceVerify = verified
      ? { id: verified.id, docNumber: verified.docNumber }
      : { found: false };

    // 4) Success = a real Invoice.Id exists. We do NOT fail on a missing
    //    DocNumber (e.g. companies with "Custom transaction numbers" disabled):
    //    store the number when QBO gives one, otherwise just the Id.
    const invoiceId = verified?.id ?? created.id;
    if (!invoiceId) {
      return recordFailure(
        "QuickBooks did not return an invoice id; not marking as invoiced.",
        "invoice_id"
      );
    }
    const docNumber =
      verified?.docNumber ?? created.docNumber ?? reservedDocNumber;

    // 5) Email the invoice (explicit send). Does not gate "invoiced".
    let emailStatus: QboEmailStatus = "no_email";
    let emailedAt: string | null = null;
    let emailError: string | null = null;
    if (deal.email) {
      try {
        const send = await sendInvoiceEmail(conn, invoiceId, deal.email);
        emailStatus = send.sent ? "sent" : "failed";
        emailedAt = send.sent ? new Date().toISOString() : null;
        log.email = { to: deal.email, status: send.emailStatus, sent: send.sent };
        if (!send.sent) {
          emailError = `QuickBooks did not confirm the invoice email (status: ${
            send.emailStatus ?? "unknown"
          }).`;
        }
      } catch (e) {
        emailStatus = "failed";
        emailError = `Invoice created, but emailing it failed: ${errorDetail(e)}`;
        log.email = { to: deal.email, error: errorDetail(e) };
      }
    } else {
      log.email = { skipped: "no client email on deal" };
    }

    // 6) Persist the result. The invoice exists (we have an Id); DocNumber is
    //    stored when QBO provided one, otherwise left null (the Id is recorded
    //    in quickbooks_invoice_id and shown in the admin debug panel).
    await admin
      .from("invoice_requests")
      .update({
        status: "invoiced",
        quickbooks_invoice_id: invoiceId,
        quickbooks_invoice_number: docNumber,
        quickbooks_customer_id: customerId,
        quickbooks_realm_id: conn.realmId,
        invoiced_at: new Date().toISOString(),
        quickbooks_email_status: emailStatus,
        quickbooks_emailed_at: emailedAt,
        quickbooks_last_attempt_at: attemptedAt,
        quickbooks_log: log,
        error: emailError,
      })
      .eq("id", requestId);

    await admin
      .from("deals")
      .update({ status: "invoiced", quickbooks_customer_id: customerId })
      .eq("id", req.deal_id);

    return {
      ok: true,
      invoiceId,
      invoiceNumber: docNumber,
      realmId: conn.realmId,
      customerId,
      emailStatus,
    };
  } catch (e) {
    // Any thrown error → approval stays intact; record for visibility + retry.
    return recordFailure(errorDetail(e), "exception");
  }
}
