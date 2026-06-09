# V2 Roadmap

Captured at the end of the V1 launch session. Nothing here is a launch blocker;
ordered by impact.

## ✅ Shipped
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

## In progress
- **Sales Rep Portal (Phase 1 — shipped):** `rep` role, rep dashboard, log-deal
  form, invoice-request approval queue for admins, commissions (record-only).
- **Sales Rep Portal (Phase 2 — next):** QuickBooks Online integration — admin
  OAuth connect, find-or-create customer, create invoice on approval (ZAR,
  once-off first). Provision-rep admin UI. Recurring/monthly invoices later.

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
