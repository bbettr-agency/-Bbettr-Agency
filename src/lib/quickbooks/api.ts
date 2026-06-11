import { apiBaseUrl, QBO_MINOR_VERSION } from "./config";
import type { ActiveConnection } from "./connection";

/**
 * Thin QuickBooks Online Accounting API client: enough to find-or-create a
 * customer and raise an invoice. Amounts use the company's home currency (we
 * don't set CurrencyRef), so a ZAR company produces ZAR invoices automatically.
 */

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
    throw new Error(`QuickBooks API ${res.status}: ${detail.slice(0, 500)}`);
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

/**
 * Find a customer by exact DisplayName, or create one. Returns the QBO
 * customer Id. Reuses an existing match so we never create duplicates.
 */
export async function findOrCreateCustomer(
  conn: ActiveConnection,
  opts: { displayName: string; email?: string | null }
): Promise<string> {
  const query = `select Id from Customer where DisplayName = '${ql(
    opts.displayName
  )}'`;
  const found = await qboFetch<QueryResponse<{ Id: string }>>(
    conn,
    `query?query=${encodeURIComponent(query)}`
  );
  const existing = found.QueryResponse.Customer?.[0];
  if (existing) return existing.Id;

  const created = await qboFetch<{ Customer: { Id: string } }>(conn, "customer", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: opts.displayName,
      ...(opts.email ? { PrimaryEmailAddr: { Address: opts.email } } : {}),
    }),
  });
  return created.Customer.Id;
}

/**
 * Find any active service/sales item to attach invoice lines to, creating a
 * generic "Agency Services" item the first time if none exists. QBO requires
 * every sales line to reference an Item.
 */
async function findOrCreateServiceItem(conn: ActiveConnection): Promise<string> {
  const found = await qboFetch<QueryResponse<{ Id: string }>>(
    conn,
    `query?query=${encodeURIComponent(
      "select Id from Item where Type = 'Service' maxresults 1"
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
      Name: "Agency Services",
      Type: "Service",
      IncomeAccountRef: { value: incomeAccountId },
    }),
  });
  return created.Item.Id;
}

export interface CreatedInvoice {
  id: string;
  docNumber: string | null;
}

/**
 * Create an invoice for a customer. A single line item carries the full amount.
 * Returns the QBO invoice Id and its DocNumber (the human invoice number).
 */
export async function createInvoice(
  conn: ActiveConnection,
  opts: {
    customerId: string;
    amount: number;
    description?: string | null;
    email?: string | null;
  }
): Promise<CreatedInvoice> {
  const itemId = await findOrCreateServiceItem(conn);

  const created = await qboFetch<{
    Invoice: { Id: string; DocNumber?: string };
  }>(conn, "invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: opts.customerId },
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Amount: opts.amount,
          Description: opts.description ?? undefined,
          SalesItemLineDetail: {
            ItemRef: { value: itemId },
            Qty: 1,
            UnitPrice: opts.amount,
          },
        },
      ],
      ...(opts.email
        ? { BillEmail: { Address: opts.email }, EmailStatus: "NeedToSend" }
        : {}),
    }),
  });

  return {
    id: created.Invoice.Id,
    docNumber: created.Invoice.DocNumber ?? null,
  };
}
