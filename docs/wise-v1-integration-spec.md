# Wise V1 Integration Spec (v1.1 — consolidated, scope-locked)

Status: **SPEC ONLY — no code.** Build target: `origin/main`. Next migration: `0025`.

## Locked scope for V1
- **QuickBooks is the source of truth for every invoice.** Every approved deal creates a QBO invoice (ZAR or USD). Wise is **only the payment-collection rail for USD**, never the invoice source of truth. PayFast is legacy-only and used for no new payments.
- **ZAR clients:** QuickBooks invoice **only**. No PayFast, no payment link. Manual / EFT confirmation.
- **USD international clients:** QuickBooks invoice **+ Wise-hosted payment link** + admin **"Mark Paid"** (manual).
- **PayFast:** **legacy only.** Existing code, routes, ITN, and historical records remain intact, but **no new invoice approval or admin action may create a PayFast link or a `payfast_payments` row** — for any currency.
- **GBP/EUR:** keep the **database/spec future-ready** (the new payment table accepts USD/GBP/EUR), but **do not enable GBP/EUR in the rep form** and **do not change `deals.currency`** unless explicitly requested later. V1 therefore emits **USD only** for international.
- **V1 needs no Wise API** — it is a structured manual workflow (admin pastes a Wise-hosted link, marks paid). This sidesteps all SA personal-token API limitations.

## Key correctness gates
1. **No new approval creates a `payfast_payments` row or a PayFast link, for any currency.** ZAR = QBO invoice + manual EFT; USD international = QBO invoice + Wise. PayFast is legacy-only.
2. **A USD payment must always be traceable to the exact QuickBooks invoice it paid.** Every `international_payments` (Wise) record **must** store the related **QuickBooks Invoice ID** and **QuickBooks Invoice Number** as **mandatory (NOT NULL)** fields — so any payment can be reconciled back to its precise QBO invoice. A Wise record is therefore only created **after** the QBO invoice exists.

---

## 1. Goal
Give international (USD) clients a professional, **true-currency** payment experience via **Wise-hosted payment links/invoices**, recorded and confirmed inside the portal — replacing the broken "USD-charged-as-ZAR" PayFast path. V1 uses **manual confirmation** (admin "Mark Paid"). ZAR stays on QuickBooks + manual EFT.

## 2. Current flow → what is being retired
Today `approveInvoiceRequestAction` calls `createPaymentForRequest()` (PayFast, ZAR) for international deals. **That call is removed from the new-approval path.** PayFast becomes **read-only legacy**: existing `payfast_payments` rows, `/pay/[id]`, the ITN webhook, and `markPayfastPaidAction` still resolve **historical** payments, but **nothing new is ever created**.

PayFast is a self-contained adapter touched only at: one seam in `approveInvoiceRequestAction`, two admin actions (`generatePayfastLinkAction`, `markPayfastPaidAction`), one UI component (`payfast-actions.tsx`), the `/pay/[id]` route, the ITN route, and a couple of read queries. Everything else is rail-agnostic.

## 3. Proposed Wise V1 flow (final)
```
Rep Deal → Invoice Request → approve → QBO invoice (ALWAYS, every currency; QBO = source of truth)
   │  (QBO returns invoice id + number, persisted on invoice_requests)
   ├─ currency = ZAR  → QBO invoice ONLY. No payment record, no link.
   │                    Client pays by manual EFT; admin confirms manually (existing).
   └─ currency = USD  → ONLY after QBO invoice succeeds: create PENDING international_payments row
                        (provider='wise', quickbooks_invoice_id + quickbooks_invoice_number copied in — mandatory).
                        Admin pastes Wise-hosted link → client pays in USD →
                        admin markInternationalPaidAction → Paid (+ intake parity, + E1 hook).
   ✗ PayFast is never invoked for any new approval (any currency).
   ✗ No Wise record is ever created without a QBO invoice id + number.
```
(`international_payments.currency` accepts USD/GBP/EUR for future-readiness, but only USD is produced in V1.)

## 4. Database / payment-record changes (migration `0025`)
New **provider-agnostic** table — leaves `payfast_payments` untouched:

**`international_payments`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| provider | text check (`'wise'`) | extensible later |
| invoice_request_id | uuid → invoice_requests, **unique** | ties to the rep/QBO invoice |
| deal_id | uuid → deals | |
| **quickbooks_invoice_id** | text **NOT NULL** | **mandatory** — the exact QBO invoice this payment settles |
| **quickbooks_invoice_number** | text **NOT NULL** | **mandatory** — QBO DocNumber (e.g. `BBTTR-000123`) for human reconciliation |
| currency | text check (`'USD','GBP','EUR'`) | **future-ready**; V1 only writes `'USD'` |
| amount | numeric(12,2) | foreign amount = invoice_request.amount + retainer |
| payment_url | text (nullable) | the Wise-hosted link, pasted by admin |
| reference | text | optional Wise payment id/ref |
| status | text check (`'pending','paid','cancelled'`) default `'pending'` | |
| paid_at / marked_paid_by | timestamptz / uuid → profiles | |
| notes | text | |
| created_at / updated_at | timestamptz | `updated_at` via existing `set_updated_at()` |

- **QBO link is mandatory + populated at creation:** `quickbooks_invoice_id` and `quickbooks_invoice_number` are `NOT NULL` and copied from `invoice_requests` (where `createInvoiceForRequest` already stores both). The portal reserves the `BBTTR-` DocNumber before sending to QBO, so both values are reliably present on a successful invoice. **The Wise row is created only when the QBO invoice succeeded** — if QBO invoicing fails, no Wise record exists and the admin retries QBO first. This makes the NOT NULL constraint always satisfiable and guarantees traceability.
- **RLS:** admins manage; reps read own (via `invoice_request.rep_id`) — mirror `payfast_payments` policies.
- **No change to `deals.currency`** (stays `ZAR,USD` from `0024`) — rep form emits USD only in V1.
- **E1 `client_payments.method`** check (`0023`, not yet deployed) → **add `'wise'`** (edit `0023` before it is applied; if `0023` is already applied, a tiny follow-up `alter`).

## 5. Admin actions needed (additive, in `admin/actions.ts`)
- **`approveInvoiceRequestAction` (the one seam):**
  - **Remove/disable** the PayFast block (the `createPaymentForRequest` call and its `client_location === 'international'` gate). Do **not** delete the function — just stop calling it.
  - `currency = USD` → **only after the QBO invoice succeeds (`invoiceResult.ok`)**, create a **pending `international_payments`** row (provider `'wise'`), copying `quickbooks_invoice_id` + `quickbooks_invoice_number` from the invoice request (both mandatory). If QBO invoicing failed, create no Wise row (admin retries QBO).
  - `currency = ZAR` → **QBO invoice only**; create **no** payment record.
- **`attachWisePaymentLinkAction(requestId, paymentUrl)`** — store the pasted Wise link on the row.
- **`markInternationalPaidAction(requestId)`** — set `status='paid'`, `paid_at`, `marked_paid_by`. **Parity (additive):** if the deal is linked to a client (D2 `deal.client_id`), call the existing `advanceIntakeStatus(client,'paid',…)` helper. **E1 hook (conditional):** if E1 is live and a matching `client_invoice` exists, insert `client_payments(method='wise')`.
- **`cancelWisePaymentAction(requestId)`** *(optional)* — mark cancelled / clear link.
- **Disable new PayFast link creation:** neutralize/hide **`generatePayfastLinkAction`** and its "Generate PayFast link" button so no new PayFast link can be minted on demand either. `markPayfastPaidAction` + ITN remain **only** for pre-existing rows.

## 6. Client portal display changes
- On the client invoice/intake view (where accessible): a **"Pay your invoice (USD)"** button → `payment_url` (Wise hosted page) + a **status badge** (Pending/Paid).
- Admin: a **`WiseActions`** component (mirror `payfast-actions.tsx`) on the Invoice Requests page — attach link, **copy link** (to share on the call/email), **Mark Paid**, status.
- Client-facing billing is otherwise admin-only in E1 V1, so in practice the admin usually shares the link directly; the portal button is the polish where the client already has access.

## 7. Currency routing logic (final — PayFast removed)
| `deal.currency` | Rail for new approvals | Confirmation |
|---|---|---|
| **ZAR** (SA or international) | **QuickBooks invoice only** — no link, no payment record | Manual EFT; existing manual confirmation |
| **USD** (international) | **QuickBooks invoice + Wise** (`international_payments`, pending link) | **Manual "Mark Paid"** (V1) |
| ~~PayFast~~ | **Never** for new approvals | Legacy rows only |

Single decision point = `deal.currency`. No PayFast branch exists in new routing. (GBP/EUR would join the Wise row once enabled in the rep form — not in V1.)

## 8. Reconciliation + how Wise payments link into E1 / `client_payments`
- **QBO is the invoice source of truth; Wise is the collection rail.** Every Wise record carries the `quickbooks_invoice_id` + `quickbooks_invoice_number`, so any payment is always reconcilable to the exact QBO invoice (and the rep deal/invoice_request behind it).
- A Wise "Paid" event is recorded as a **`client_payments` row with `method='wise'`** — *only when* E1 is deployed **and** the deal is linked to a client (D2) with a corresponding `client_invoice`. Carry the QBO id/number onto that record too (E1 `client_invoices` already has `quickbooks_invoice_id`/`quickbooks_invoice_number` reference fields).
- Otherwise the source of truth for collection status is the `international_payments` row; the E1 write is a **conditional, decoupled hook**. E1 stays structurally untouched — Wise is just another `method` value.

## 9. What stays unchanged (PayFast retained, dormant)
- **PayFast retained but never called for new work:** `lib/payfast/*`, `/pay/[id]`, `/api/payfast/notify` (ITN), and all historical `payfast_payments` rows remain functional for legacy/history. **No new `payfast_payments` rows are ever created.**
- **QuickBooks** issues the invoice for **every** approval (ZAR and USD) — unchanged.
- **Commissions, intake logic files, E1 core, invoice_requests core, rep deal creation** — unchanged. (No rep-form/currency change in V1.)
- **Three portals' structure** — unchanged.

## 10. Risks / dependencies
- **External (the real risks, not engineering):** confirm with Wise (SA launch is new) — **card-acceptance eligibility** on SA Business accounts; **Platform/webhook access** (needed only for V2 auto-confirm). V1 works regardless via manual confirmation.
- **Manual-confirmation discipline** — admin must mark paid promptly; mitigate with a clear "Awaiting payment" status in the admin list.
- **Correctness gate enforcement** — the routing edit plus disabling `generatePayfastLinkAction` together guarantee no new PayFast links.
- **Exchange control (SARB)** — Wise being SA-licensed should ease inbound forex; confirm operationally.
- **No Wise API credentials needed for V1** — lowest-risk surface.

## 11. Step-by-step implementation order
1. **Migration `0025`:** `international_payments` table (+RLS, `set_updated_at` trigger). *(If E1 `0023` not yet applied: add `'wise'` to `client_payments.method` in `0023`.)* No `deals.currency` change.
2. **Types:** add `international_payments` to `database.types.ts`.
3. **`lib/wise`** (no API): provider constant, `isWiseCurrency(currency)` predicate, `getWisePaymentForRequest()` read helper.
4. **`approveInvoiceRequestAction`:** delete/disable the PayFast block; `USD` → pending Wise row; `ZAR` → QBO invoice only. Disable `generatePayfastLinkAction` + its button.
5. **Admin actions:** `attachWisePaymentLinkAction`, `markInternationalPaidAction` (+ intake parity + E1 hook), optional cancel.
6. **Admin UI:** `WiseActions` component on Invoice Requests; read `international_payments` in `admin-queries`/`rep-queries`.
7. **Client display:** pay-link button + status on invoice/intake view.
8. **Regression pass:** ZAR (QBO-only), legacy PayFast rows, QBO, commissions, rep deal creation all behave as before.

## 12. Testing checklist
- **ZAR deal (SA or international)** → approve → **QBO invoice created, NO `payfast_payments` row, NO link**; manual confirmation works.
- **USD deal** → approve → pending Wise row, **NO PayFast row**; attach link → client opens Wise hosted page (USD) → Mark Paid → status Paid.
- **Traceability gate:** every Wise row has a non-null `quickbooks_invoice_id` + `quickbooks_invoice_number` matching the QBO invoice; the row maps 1:1 to its invoice request. Confirm a Wise record is **never** created when QBO invoicing failed (no id/number) — approval leaves the request retryable instead.
- **Correctness gate:** across **all** currencies, **zero new `payfast_payments` rows** from any approval; "Generate PayFast link" unavailable for new deals.
- **Intake parity:** marking a linked new-client's Wise payment Paid advances intake to `paid` (matches old PayFast behaviour).
- **E1 (when live):** Wise Paid creates a `client_payments(method='wise')` row against the right invoice; KPIs reflect it.
- **Legacy:** an existing PayFast payment still displays and `markPayfastPaidAction`/ITN still resolve it.
- **Reps** see Wise payment status for their own deals; **RLS** blocks others.
- No regressions to QBO, commissions, rep deal creation, the `/pay` route, or the ITN handler.

## 13. Future V2 — webhook / auto-confirmation
- Apply for **Wise Platform (OAuth) access**; add a `lib/wise` API client + a **`/api/wise/notify`** webhook route (mirroring the PayFast ITN route) for **`swift-in#credit` / payment-completed** events → auto-set `international_payments.status='paid'` + the same intake/E1 effects.
- Optional: **API-created links/invoices** (replacing the manual paste) if exposed to the account tier.
- A `WISE_AUTOCONFIRM_ENABLED`-style flag toggles auto vs manual, like `PAYFAST_ITN_ENABLED`.
- Note: SA personal-token **balance/statement APIs are unavailable**, so auto-confirm depends specifically on **Platform** access — V1 must not assume it.
- **GBP/EUR enablement (separate, explicit request):** expand `deals.currency` + add GBP/EUR options to the rep pricing-type selector. The payment table already accepts these currencies.

---

## Developer handover summary

**Build (all additive):**
1. Migration `0025`: provider-agnostic `international_payments` (currency check `USD/GBP/EUR`, V1 writes USD only; **`quickbooks_invoice_id` + `quickbooks_invoice_number` NOT NULL**) + admin/rep RLS + `set_updated_at` trigger. Add its types to `database.types.ts`. *(Add `'wise'` to E1 `client_payments.method` when `0023` is applied.)*
2. `lib/wise`: thin module — `isWiseCurrency()`, provider constants, a read query. **No Wise API calls in V1.**
3. **`approveInvoiceRequestAction`:** **remove/disable the PayFast call**; `USD` → pending Wise row **created only after the QBO invoice succeeds, copying the mandatory `quickbooks_invoice_id` + `quickbooks_invoice_number`**; `ZAR` → QBO invoice only.
4. Admin actions: `attachWisePaymentLinkAction`, `markInternationalPaidAction` (set paid + **call existing `advanceIntakeStatus` for parity** + **conditional `client_payments(method='wise')` write when E1 is live**); optional cancel.
5. **Disable new PayFast link creation** (`generatePayfastLinkAction` + button).
6. `WiseActions` admin UI (mirror `payfast-actions.tsx`) + client pay-link button/status.

**Do NOT touch / must remain:**
- `lib/payfast/*`, `/pay/[id]`, `/api/payfast/notify`, historical `payfast_payments` — **kept intact for legacy/history; never called for new approvals.** Do not delete PayFast code in V1.
- `lib/quickbooks/*` (issues every invoice), commission logic, intake *logic files* (only *call* `advanceIntakeStatus`; don't modify it), E1 *core* (only add `'wise'` as a `method` value + write rows via the existing pattern), `invoice_requests` core, and **rep deal creation / `deals.currency`** (no GBP/EUR in V1).

**Key correctness gates (final):**
1. **No new invoice approval generates a PayFast link or a new `payfast_payments` row — for any currency.** ZAR = QBO invoice + manual EFT; USD = QBO invoice + Wise. PayFast is legacy-only.
2. **QuickBooks is the source of truth; every Wise payment is traceable to its exact QBO invoice** via mandatory `quickbooks_invoice_id` + `quickbooks_invoice_number`. No Wise record exists without them.
