import { apiBaseUrl, QBO_MINOR_VERSION } from "./config";
import type { ActiveConnection } from "./connection";

/**
 * Thin QuickBooks Online Accounting API client: enough to find-or-create a
 * customer, raise an invoice, re-read it, and email it. Amounts use the
 * company's home currency (we don't set CurrencyRef), so a ZAR company produces
 * ZAR invoices automatically.
 */

/** Error carrying the QBO HTTP status + raw response body for diagnostics. */
export class QboApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`QuickBooks API ${status}: ${body.slice(0, 500)}`);
    this.name = "QboApiError";
    this.status = status;
    this.body = body;
  }
}

function buildUrl(conn: ActiveConnection, path: string): string {
  const base = apiBaseUrl(conn.environment);
  return `${base}/v3/company/${conn.realmId}/${path}${
    path.includes("?") ? "&" : "?"
  }minorversion=${QBO_MINOR_VERSION}`;
}

async function qboFetch<T>(
  conn: ActiveConnection,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(buildUrl(conn, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new QboApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** Escape a value for a QBO query string literal. */
function ql(value: string): string {
  return value.replace(/'/g, "\\'");
}

interface QueryResponse<T> {
  QueryResponse: Record<string, T[] | undefined>;
}

export interface CustomerResult {
  id: string;
  /** true if we created it this call, false if an existing match was reused. */
  created: boolean;
}

/**
 * Find a customer by exact DisplayName, or create one. Returns the QBO customer
 * Id and whether it was newly created. Reuses an existing match so we never
 * create duplicates.
 */
export async function findOrCreateCustomer(
  conn: ActiveConnection,
  opts: { displayName: string; email?: string | null; currency?: "ZAR" | "USD" }
): Promise<CustomerResult> {
  const query = `select Id from Customer where DisplayName = '${ql(
    opts.displayName
  )}'`;
  const found = await qboFetch<QueryResponse<{ Id: string }>>(
    conn,
    `query?query=${encodeURIComponent(query)}`
  );
  const existing = found.QueryResponse.Customer?.[0];
  if (existing?.Id) return { id: existing.Id, created: false };

  const created = await qboFetch<{ Customer: { Id: string } }>(conn, "customer", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: opts.displayName,
      ...(opts.email ? { PrimaryEmailAddr: { Address: opts.email } } : {}),
      // A QBO customer's currency is fixed at creation. USD needs Multicurrency
      // enabled; ZAR (home) needs no CurrencyRef. Only set for new USD customers.
      ...(opts.currency === "USD" ? { CurrencyRef: { value: "USD" } } : {}),
    }),
  });
  if (!created.Customer?.Id) {
    throw new Error("QuickBooks did not return a customer id.");
  }
  return { id: created.Customer.Id, created: true };
}

/** Confirm a customer still exists (used when reusing a stored id). */
export async function customerExists(
  conn: ActiveConnection,
  customerId: string
): Promise<boolean> {
  try {
    const res = await qboFetch<{ Customer?: { Id?: string } }>(
      conn,
      `customer/${encodeURIComponent(customerId)}`
    );
    return Boolean(res.Customer?.Id);
  } catch (e) {
    if (e instanceof QboApiError && e.status === 404) return false;
    throw e;
  }
}

/** QBO item names cannot contain ':' (reserved for sub-items) and are capped at
 *  100 chars; normalise a package name to a safe item name. */
function safeItemName(name: string): string {
  const cleaned = name.replace(/:/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Agency Services").slice(0, 100);
}

/**
 * Find a Service item by its EXACT name, or create it (backed by the first
 * income account). Each service package maps to its own named QBO product/
 * service, created once — so an invoice line shows the correct product/service
 * (the package sold) instead of reusing whatever item happened to exist first.
 */
async function findOrCreateServiceItemByName(
  conn: ActiveConnection,
  name: string
): Promise<string> {
  const itemName = safeItemName(name);
  const found = await qboFetch<QueryResponse<{ Id: string }>>(
    conn,
    `query?query=${encodeURIComponent(
      `select Id from Item where Name = '${ql(itemName)}'`
    )}`
  );
  const existing = found.QueryResponse.Item?.[0];
  if (existing) return existing.Id;

  // Need an income account to back a new item; pick the first income account.
  const accounts = await qboFetch<QueryResponse<{ Id: string }>>(
    conn,
    `query?query=${encodeURIComponent(
      "select Id from Account where AccountType = 'Income' maxresults 1"
    )}`
  );
  const incomeAccountId = accounts.QueryResponse.Account?.[0]?.Id;
  if (!incomeAccountId) {
    throw new Error(
      "No income account found in QuickBooks to create a service item."
    );
  }

  const created = await qboFetch<{ Item: { Id: string } }>(conn, "item", {
    method: "POST",
    body: JSON.stringify({
      Name: itemName,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccountId },
    }),
  });
  return created.Item.Id;
}

export interface CreatedInvoice {
  id: string;
  docNumber: string | null;
  /** The raw parsed QBO create/read response, for diagnostics/logging. */
  raw?: unknown;
}

/** One invoice line: its product/service name, amount, and optional description. */
export interface InvoiceLineInput {
  itemName: string;
  amount: number;
  description?: string | null;
}

/**
 * Create an invoice for a customer with one or more line items. Each line's
 * product/service is found-or-created by its exact name (so a once-off package
 * and a monthly retainer become two distinct, correctly-named lines, never
 * combined). QBO sums the lines for the invoice total. Returns the QBO invoice
 * Id and DocNumber plus the raw response. The email is sent separately via
 * `sendInvoiceEmail`; setting BillEmail here only records the address.
 */
export async function createInvoice(
  conn: ActiveConnection,
  opts: {
    customerId: string;
    lines: InvoiceLineInput[];
    docNumber?: string | null;
    email?: string | null;
    /** ZAR (home currency, no CurrencyRef) or USD (requires QBO Multicurrency). */
    currency?: "ZAR" | "USD";
  }
): Promise<CreatedInvoice> {
  // Resolve each line's item sequentially (avoids creating a duplicate item if
  // two lines somehow shared a name), then build the QBO Line array.
  const qboLines = [];
  for (const line of opts.lines) {
    const itemId = await findOrCreateServiceItemByName(conn, line.itemName);
    qboLines.push({
      DetailType: "SalesItemLineDetail",
      Amount: line.amount,
      Description: line.description ?? undefined,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: 1,
        UnitPrice: line.amount,
      },
    });
  }

  const response = await qboFetch<{
    Invoice: { Id: string; DocNumber?: string };
  }>(conn, "invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: opts.customerId },
      // Portal-assigned invoice number (requires "Custom transaction numbers"
      // ON in QBO). QBO echoes it back and prints it on the PDF/email.
      ...(opts.docNumber ? { DocNumber: opts.docNumber } : {}),
      Line: qboLines,
      ...(opts.email ? { BillEmail: { Address: opts.email } } : {}),
      // Home currency (ZAR) needs no CurrencyRef. USD is set explicitly and must
      // match the customer's currency; requires QBO Multicurrency to be enabled.
      ...(opts.currency === "USD" ? { CurrencyRef: { value: "USD" } } : {}),
    }),
  });

  if (!response.Invoice?.Id) {
    throw new Error("QuickBooks did not return an invoice id.");
  }
  return {
    id: response.Invoice.Id,
    docNumber: response.Invoice.DocNumber ?? null,
    raw: response,
  };
}

/**
 * Re-read an invoice by Id to confirm it persisted and obtain the authoritative
 * DocNumber (the number actually visible in QuickBooks). Returns null if the
 * invoice cannot be found.
 */
export async function getInvoice(
  conn: ActiveConnection,
  invoiceId: string
): Promise<CreatedInvoice | null> {
  try {
    const res = await qboFetch<{
      Invoice?: { Id?: string; DocNumber?: string };
    }>(conn, `invoice/${encodeURIComponent(invoiceId)}`);
    if (!res.Invoice?.Id) return null;
    return {
      id: res.Invoice.Id,
      docNumber: res.Invoice.DocNumber ?? null,
      raw: res,
    };
  } catch (e) {
    if (e instanceof QboApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Find an invoice by its exact DocNumber. Used for retry-idempotency: if a prior
 * attempt already created the invoice in QBO (but we failed to persist its Id),
 * we adopt that invoice instead of creating a duplicate with the same number.
 */
export async function findInvoiceByDocNumber(
  conn: ActiveConnection,
  docNumber: string
): Promise<CreatedInvoice | null> {
  const query = `select Id, DocNumber from Invoice where DocNumber = '${ql(
    docNumber
  )}'`;
  const res = await qboFetch<QueryResponse<{ Id: string; DocNumber?: string }>>(
    conn,
    `query?query=${encodeURIComponent(query)}`
  );
  const found = res.QueryResponse.Invoice?.[0];
  if (!found?.Id) return null;
  return { id: found.Id, docNumber: found.DocNumber ?? docNumber, raw: found };
}

export interface SendResult {
  /** true when QuickBooks confirmed EmailStatus = EmailSent. */
  sent: boolean;
  emailStatus: string | null;
}

/**
 * Ask QuickBooks to email the invoice to the given address. QBO sends the email
 * server-side and returns the updated invoice with EmailStatus = "EmailSent".
 * We treat that as confirmation.
 *
 * IMPORTANT: the send operation must be POSTed with Content-Type
 * `application/octet-stream` and an EMPTY body. Calling it with
 * `application/json` (the default for other QBO calls) makes Intuit's server
 * attempt to parse an empty JSON payload and throw a NullPointerException /
 * SystemFailureError. We override the content type here and send no body.
 */
export async function sendInvoiceEmail(
  conn: ActiveConnection,
  invoiceId: string,
  email: string
): Promise<SendResult> {
  const path = `invoice/${encodeURIComponent(
    invoiceId
  )}/send?sendTo=${encodeURIComponent(email)}`;

  const attempt = () =>
    qboFetch<{ Invoice?: { EmailStatus?: string } }>(conn, path, {
      method: "POST",
      // No body; octet-stream so QBO doesn't try to parse a JSON payload.
      headers: { "Content-Type": "application/octet-stream" },
    });

  let res: { Invoice?: { EmailStatus?: string } };
  try {
    res = await attempt();
  } catch (e) {
    // QBO sandbox occasionally throws a transient SystemFailureError /
    // NullPointerException on send; retry once after a short pause. Scoped to
    // that signature so we never re-send on an ordinary error.
    if (
      e instanceof QboApiError &&
      /SystemFailureError|NullPointer/i.test(e.body)
    ) {
      await new Promise((r) => setTimeout(r, 600));
      res = await attempt();
    } else {
      throw e;
    }
  }

  const emailStatus = res.Invoice?.EmailStatus ?? null;
  return { sent: emailStatus === "EmailSent", emailStatus };
}
