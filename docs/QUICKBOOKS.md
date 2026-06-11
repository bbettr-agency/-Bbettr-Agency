# QuickBooks Online Integration (Phase 2)

Raises a QuickBooks Online (QBO) invoice automatically when an admin approves a
sales-rep invoice request. Fully **isolated**: if QBO isn't configured or
connected, the rest of the portal is unaffected — approvals still record
commissions; only the invoice creation is skipped (and is retryable).

## How it works

1. A rep logs a deal → an `invoice_request` is created (`pending`).
2. Admin **approves** it (`/admin/invoices`):
   - status → `approved`, commission recorded, rep notified (unchanged from V1).
   - **then**, best-effort, a QBO invoice is created.
3. On success: status → `invoiced`, the QBO invoice **id + number** are stored,
   the deal's QBO **customer id** is stored (reused for future invoices), the
   deal status → `invoiced`, and the rep is notified with the invoice number.
4. On failure (or if QBO isn't connected): the approval and commission **stay
   intact**, the error is recorded on the request, admins are notified, and the
   admin can **Retry invoice** from `/admin/invoices`.

> **Decoupled by design:** a QuickBooks failure never reverses an approval or a
> recorded commission. Invoice creation is idempotent — a request that already
> has a QBO invoice id is never invoiced twice.

## Architecture

| Piece | Location |
|---|---|
| Config (env) | `src/lib/quickbooks/config.ts` |
| Token encryption (AES-256-GCM) | `src/lib/quickbooks/crypto.ts` |
| OAuth + token refresh + storage | `src/lib/quickbooks/connection.ts` |
| QBO API (customer / item / invoice) | `src/lib/quickbooks/api.ts` |
| Public surface | `src/lib/quickbooks/index.ts` |
| OAuth start | `GET /api/quickbooks/connect` |
| OAuth callback | `GET /api/quickbooks/callback` |
| Admin connect/disconnect UI | `/admin/integrations` |
| Approval wiring | `approveInvoiceRequestAction`, `retryInvoiceRequestAction` |

**Tokens are encrypted at rest** (AES-256-GCM, key derived from
`QBO_TOKEN_SECRET`) before being written to `quickbooks_connection`, which is
only ever read/written via the service-role client. OAuth uses a CSRF `state`
stored in an httpOnly cookie and re-checked in the callback.

Invoices are created **without** a `CurrencyRef`, so they use the QBO company's
home currency automatically (a ZAR company produces ZAR invoices). Each invoice
line references a Service item ("Agency Services" is created once if none
exists).

## Database (`0011_quickbooks.sql`)

> Re-integrated onto the V1 baseline as migration **`0011`** (prod runs
> `0001`–`0010`; `0009` = rep hardening, `0010` = deal client location).


- `quickbooks_connection` — single-row table (`id = true`) holding the encrypted
  `access_token` / `refresh_token`, `realm_id`, expiries, environment. RLS
  admin-only (defence-in-depth).
- `invoice_requests` — adds `quickbooks_invoice_number`, `invoiced_at`
  (the QBO columns `quickbooks_invoice_id` / `quickbooks_customer_id` already
  existed from `0007`).
- `deals` — adds `quickbooks_customer_id` (so repeat invoices reuse the
  customer).

## Environment variables

| Var | Purpose |
|---|---|
| `QBO_CLIENT_ID` | Intuit app client id |
| `QBO_CLIENT_SECRET` | Intuit app client secret |
| `QBO_ENVIRONMENT` | `sandbox` or `production` |
| `QBO_REDIRECT_URI` | Must match the Redirect URI on the Intuit app exactly |
| `QBO_TOKEN_SECRET` | Secret for encrypting tokens (`openssl rand -base64 32`) |

## Connecting

1. Create an app at <https://developer.intuit.com> (scope:
   `com.intuit.quickbooks.accounting`). Add the redirect URI
   `https://portal.bbettragency.com/api/quickbooks/callback`.
2. Set the `QBO_*` env vars in Vercel and redeploy.
3. Go to **Admin → Integrations → Connect QuickBooks**, authorise, and you're
   returned to the page showing "Connected".

## Deferred (future)

- Paid-status sync (webhook / polling) back into the portal.
- Recurring / monthly invoices for `monthly` billing deals.
- Per-deal line-item breakdowns and tax codes.
