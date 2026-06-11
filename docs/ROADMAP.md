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

## Next major feature
- **QuickBooks Online (Phase 2 — ✅ SANDBOX COMPLETE & VERIFIED, ⏸️ production
  not connected):** invoicing on invoice-request approval — admin OAuth connect,
  find-or-create (and reuse) customer, create invoice (ZAR, once-off), and email
  it. **Re-integrated onto the V1 + client-location baseline** as branch
  `claude/quickbooks-reintegration` + migrations `0011_quickbooks` and
  `0012_quickbooks_audit` (not a merge of the old branch). Decoupled /
  best-effort / idempotent / retryable; preserves all V1 behaviour.
  - **Verified in sandbox (2026-06-11):** customer create + reuse, invoice create,
    invoice numbering (real QBO `DocNumber`, e.g. #1039), invoice visible in the
    sandbox, invoice email send (octet-stream send fix for the QBO
    `SystemFailureError`/`NullPointerException`), admin audit/debug panel, realm
    verification. Status integrity: only marked `invoiced` after the invoice is
    re-read and a valid Id + DocNumber are returned.
  - **To go live:** flip `QBO_ENVIRONMENT=production`, reconnect against the live
    company, verify realm/company on Integrations, then invoice a real deal.
  - **Later:** recurring / monthly invoices, paid-status sync.
- **PayFast (international payments — not started, after QuickBooks is in
  production):** dedicated `payfast_payments` table + migration **`0013`** (now
  that `0012` is the QuickBooks audit), signed payment link for `international`
  deals + ITN webhook, paired with the QuickBooks invoice.

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
