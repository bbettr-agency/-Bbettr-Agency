# V2 Roadmap

Captured at the end of the V1 launch session. Nothing here is a launch blocker;
ordered by impact.

## ✅ Shipped
- **🏁 Sales Rep Portal V1 (milestone — complete, stable baseline):** the rep
  portal end-to-end. `rep` role + role-aware routing; **deactivation enforced**;
  Dashboard / My Deals (filters) / New Deal (price required) / My Earnings;
  Admin → Reps (create, activate/deactivate, reset password, **welcome email with
  credentials**, Sales Value & Commission totals, **Delete Rep**); Invoice
  Requests approve/reject (commission record-only) with guards; **in-app bell
  blue dots** for submit/approve/reject; **Resend emails** (welcome creds, new
  request → `info@bbettragency.com`, approve/reject → rep); correct invoice-
  request status on the rep detail page; RLS hardening (migration `0009`).
  Delivered as 4 sequential patches (`fix-rep-portal-stabilisation` →
  `add-delete-rep` → `delete-rep-bypass-history-guard` → `fix-rep-portal-final`).
  ⚠️ **Testing-only:** the Delete Rep history guard is bypassed (patch ③) —
  restore it (or ship Archive Rep) before production. See `SESSION_HANDOVER.md`.
- **Email notifications** — Event → DB notification → branded Resend email
  (update / report / stage advanced / assets-needed / action-required) +
  client action-required banner. Resend = production transactional provider.
- **Client Portal Maintenance Mode** — admin toggle (Admin → Settings) backed by
  the `portal_settings` table (migration 0006); clients see a branded
  maintenance screen, admin access unaffected.
- **Client Notification Center** — bell icon in the client header with unread
  count, dropdown feed (type icons, time-ago, unread highlight, action-required
  pinned), per-item mark-as-read on click + "Mark all as read". Reuses the
  existing `notifications` table / `read_at` (no migration). Client-only.

## Post-V1 increments (shipped as patches)
- **Deal Client Location (patch `feat-deal-client-location.patch`):** stores
  where the client is based (`south_africa` / `international`) on the deal, so
  payments can later be routed. Migration `0010_deal_client_location` (enum +
  column). Rep picks it on New Deal (required); shown in admin + rep deal views
  and the new-request email. **Storage/display only** — future routing:
  `south_africa` → QuickBooks invoice / EFT; `international` → QuickBooks invoice
  + PayFast payment link. No QuickBooks/PayFast/approval changes.

## Shipped — 2026-06-14 (QuickBooks live + PayFast international payments)

- **QuickBooks Online (Phase 2 — ✅ LIVE IN PRODUCTION):** invoicing on
  invoice-request approval — admin OAuth connect, find-or-create (and reuse)
  customer, create invoice (ZAR), and email it. Decoupled / best-effort /
  idempotent / retryable; preserves all V1 behaviour.
  - Verified in sandbox (2026-06-11), then taken **live** and confirmed with real
    invoicing. Status integrity preserved: only marked `invoiced` after the
    invoice is re-read and a valid Id is returned.
  - **Polish shipped today:** treat `Invoice.Id` as the success signal (don't
    fail on a briefly-missing `DocNumber`); **structured service packages** →
    correct QBO product/service + description (migration `0013`); **portal-
    assigned invoice numbers** `BBTTR-000001` on the PDF/email (migration `0014`,
    `next_qbo_invoice_docnumber()`); **optional monthly retainer** as a second
    invoice line (migration `0015`).
  - **Later:** recurring / monthly automated invoices, deeper paid-status sync.

- **PayFast (international payments — ✅ LIVE & TESTED, V1 + V2):** international
  deals (`client_location = 'international'`) get a signed PayFast payment link
  once invoiced; South African clients are unaffected (QuickBooks invoice + EFT,
  never a link). Decoupled / env-flagged / idempotent; no QuickBooks, commission
  or SA/EFT impact.
  - **V1 (migration `0016_payfast_payments`):** generate + store + display the
    link, with manual admin **Mark as paid**. `payfast_payments` table (1:1
    UNIQUE per invoice request → no duplicate links). Admin Invoice Requests:
    badge + copy link + mark paid. Rep My Deals: **Payment** column (EFT for SA;
    Pending + copy link / Paid for international). Public `/pay/<id>` checkout
    hand-off + `/pay/return` + `/pay/cancel`. **Tested with a real payment.**
  - **Live/sandbox switch:** `PAYFAST_ENVIRONMENT` accepts `live` / `production`
    / `prod`. Admin **Integrations → PayFast** diagnostics card (non-secret).
  - **V2 (migration `0017_payfast_itn`):** `POST /api/payfast/notify` ITN webhook
    auto-marks a payment `paid` on a verified `COMPLETE`. Verifies signature +
    server-to-server validate postback + merchant id + amount. Idempotent,
    tamper-resistant, always 200, no secrets logged. Manual Mark Paid retained as
    fallback; `PAYFAST_ITN_ENABLED` kill-switch (default on). **Tested & working.**

### Next for payments (deferred, not blockers)
- "Payment received" notification to the rep on a verified `COMPLETE` ITN.
- Email the PayFast link directly to the international client (today: copy/paste).
- Reconcile / flag links stuck `pending` for N days for admin follow-up.
- Unit tests for the signature builder + ITN verification (pure functions).
- Tidy / gate the temporary admin PayFast debug card once stable.

## Pre-production cleanup (before launch)
- **Restore the Delete Rep history guard** (or ship the **Archive Rep**
  workflow). Patch ③ removed it for testing — deleting a rep currently cascades
  away all their sales history. Marked in code:
  "Restore historical-data protection before production launch."

## High impact
1. **Supabase Realtime** — live cross-tab updates so an already-open admin or
   client tab refreshes without navigation. Closes the one gap revalidation
   can't cover (admin posts update → client's open tab updates instantly).
2. **Email notifications** — new report, new update, "assets needed" nudge,
   client invite email with credentials. (Supabase Auth emails + a transactional
   provider, e.g. Resend.)
3. **Error monitoring + CI** — Sentry for runtime errors; a GitHub Action running
   `typecheck` + `build` on every push/PR.

## Medium impact
4. **Pagination + SQL-side aggregation** — admin client list currently joins in
   JS; global reports/files/updates and client reports/files are unbounded.
   Move to SQL views / `.range()` pagination before ~100 clients or thousands of
   rows.
5. **Auto-computed report metrics** — derive `cost_per_lead` from
   `ad_spend / leads_generated` server-side; store inputs only.
6. **Onboarding draft auto-save** — persist on change so a refresh never loses
   typed answers.

## Larger / later
7. **Analytics integrations** — GA4 / Google Ads / Meta pulling metrics into
   reports automatically.
8. **Team seats & granular roles** — multiple agency users, scoped permissions.
9. **Audit log** — who changed what, when (esp. deletions and status changes).
10. **White-label theming per client.**
11. **Generated Supabase types** — replace the hand-maintained
    `src/lib/database.types.ts` with `supabase gen types typescript` to prevent
    drift.

## Notes / tech debt
- Stage automation matches stage names exactly; consider a stable `key` column
  if stages become customizable.
- Client file uploads are browser-side, so admin counts refresh on next load.
