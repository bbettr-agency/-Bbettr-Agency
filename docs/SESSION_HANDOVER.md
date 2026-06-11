# Session Handover — Bbettr Agency Client Portal

_Last updated: 2026-06-11 · Production: https://portal.bbettragency.com_

This is the single source of truth for picking the project back up. All project
docs live under [`docs/`](./).

---

## ⭐ Latest session (2026-06-11) — Sales Rep Portal stabilisation

**Status: complete. Delivered as a patch to apply to `main`, not a PR.**
Patch: `fix-rep-portal-stabilisation.patch` · branch `claude/rep-portal-stabilise`
(branched from `origin/main` @ `19f465f`). Verified: `tsc` ✅ · `lint` ✅ ·
`build` ✅. **Not merged, not deployed.**

Full audit of the rep portal (auth, dashboard, My Deals, New Deal, My Earnings,
Admin Reps, Invoice Requests, RLS, UX). All approved P1 + P2 + P3 fixes applied:

- **P1 (critical)**
  - **Rep deactivation is now enforced.** New `isRepActive()` gates the `(rep)`
    layout (inactive reps see a branded "Account Deactivated" screen + sign-out)
    and `createDealAction` (returns an error). Previously `reps.active` was
    display-only — a deactivated rep could still log in and submit deals.
  - **`rejectInvoiceRequestAction` guarded** with a not-found return +
    `status === 'pending'` check (matching approve), so an already-approved
    request with a recorded commission can't be flipped to rejected.
- **P2 (integrity/accuracy)**
  - Deal **price is now required and must be > 0** (client `required`/`min` +
    server validation); invoice amounts are never R0/negative.
  - **Orphan deals removed**: if the `invoice_request` insert fails, the
    just-created deal is deleted.
  - Relabelled the duplicated **"Pending Commission" → "Unpaid Commission"** card
    and the dashboard month tile → **"Awaiting Approval"**.
- **P3 (hardening/polish)**
  - Commission-insert failure on approve is now surfaced, not swallowed.
  - **Migration `0009_rep_portal_hardening.sql`** drops the unused
    `"Reps update own deals"` RLS policy (closes a rep self-tamper vector).
  - Added a **confirm step to Reject**; tidied the Invoice Requests copy.

**Files:** `src/lib/auth.ts`, `src/app/(rep)/layout.tsx`,
`src/app/(rep)/rep/actions.ts`, `src/app/(rep)/rep/page.tsx`,
`src/app/(rep)/rep/earnings/page.tsx`, `src/components/rep/new-deal-form.tsx`,
`src/components/rep/rep-disabled-screen.tsx` (new),
`src/app/(admin)/admin/actions.ts`,
`src/app/(admin)/admin/invoices/page.tsx`,
`src/components/admin/invoice-request-actions.tsx`,
`supabase/migrations/0009_rep_portal_hardening.sql` (new).

**To apply (when you're ready — not done here):**
```bash
git checkout main && git pull
git am < fix-rep-portal-stabilisation.patch     # or: git apply
# then run migration 0009_rep_portal_hardening.sql in Supabase (single DROP POLICY)
```

### ⚠️ Migration numbering — `0009` is now rep hardening
- Production is at migrations `0001`–`0008`. **This patch adds `0009`** =
  `0009_rep_portal_hardening.sql`.
- **QuickBooks Phase 2 remains UNDEPLOYED** on its own branch
  (`claude/modest-darwin-zBsfw`). Its migration was drafted as `0009` and **must
  be renumbered to `0010`** before it is ever taken forward, so both can apply in
  order. **Do not proceed with QuickBooks without explicit approval.**

> ⚠️ **History divergence note (read this first).** On 2026-06-04 we found that
> the deployed `main` had drifted from the intended state: several patches were
> applied out of order / partially (a `git am` that stopped mid-way), so `main`
> was missing **six** commits of work even though earlier testing had passed
> against a deploy that contained them. The recovery is documented in
> [§8 Recovery](#8-recovery--bringing-main-back-to-true-state). Going forward,
> prefer the **bundle** over stacking patches, and always run
> `git log --oneline` after applying to confirm what actually landed.

---

## 1. What was built (full intended state)

A production, **multi-tenant SaaS** client portal + agency operating system:

- **Auth & roles** — Supabase Auth, `admin` vs `client`, role-aware routing.
- **Multi-tenancy** — PostgreSQL Row-Level Security; tenant-scoped Storage.
- **Client portal** — dashboard with live roadmap phase, dynamic onboarding,
  asset-readiness checklist, project progress, updates, monthly reports, files,
  **sidebar notification dots**, **onboarding-complete state**.
- **Admin OS** — overview, client list, create-client, per-client workspace
  (onboarding view, stage manager, Mark Assets Received, update & report
  composers, files, **Portal Access**), global views, settings, client deletion.
- **Design system** — brand `#38B6FF`, Inter + Sora.

Stack: **Next.js 15 (App Router) · TypeScript · Tailwind · Supabase · Vercel.**

---

## 2. Full commit lineage (intended `main`)

In order (oldest → newest). Messages, not SHAs (SHAs differ after `git am`):

1. Build Bbettr Agency Client Portal (Phase 1 MVP)
2. Add SessionStart hook for Claude Code on the web
3. Harden core flows for V1 launch (4 critical fixes)
4. Fix 500 on /admin and /dashboard (server→client nav boundary)
5. Fix invisible asChild buttons (Create Client CTA)
6. Make onboarding flow seamless (auto-advance, live refresh)
7. Fix onboarding writes silently blocked by RLS (root cause)
8. Add full client lifecycle deletion (admin)
9. **Add asset-readiness workflow (client checklist + admin approval)**
10. **Project lifecycle cleanup (revalidation, Account Status, roadmap as truth)**
11. docs: add organized docs/ folder and session handover
12. **Onboarding completion UX (sidebar check, completion message)**
13. **Client notifications (blue sidebar dots) + migration 0004**
14. **Portal Access (admin) with swappable email service**

---

## 3. Current production status (as of 2026-06-04)

- ✅ Live at https://portal.bbettragency.com
- ⚠️ **`main` was at the equivalent of commit 8 + the 0004 migration**, missing
  commits **9–14**. Recovery in §8 brings it whole.
- ✅ Migration `0004_notifications.sql` **was run in Supabase** (the table
  exists), and committed to `main` as a standalone commit.

---

## 4. Supabase status

- ✅ Migrations 0001–0004 applied (incl. `client_section_views`).
- ✅ 8 + 1 tables with RLS; `client-files` bucket private + tenant-scoped.
- ✅ First admin created; **public sign-up DISABLED**.
- ✅ Auth URLs set to the production domain.
- For Portal Access emails: uses Supabase's built-in auth email. Configure SMTP
  for production deliverability. Email is abstracted (`src/lib/email/`) so V2 can
  swap to Resend with no caller changes.

---

## 5. Vercel / domain status

- ✅ Repo `bbettr-agency/-Bbettr-Agency`, default branch `main`, auto-deploys.
- ✅ Env vars set; domain `portal.bbettragency.com` connected.

---

## 6. Today's features (commits 12–14)

- **Onboarding completion UX** — `isOnboardingComplete` (submitted/approved
  across all services), green sidebar check, "Onboarding Complete — Our team is
  now preparing your project." (replaces the old, buggy `!== "approved"` nudge).
- **Client notifications** — blue dots on Project/Updates/Reports/Files when
  activity is newer than the client's last view; clears on visit. New
  `client_section_views` table (migration 0004), `getClientNotifications`,
  `markSectionViewedAction`, `<SeenMarker>`. Activity-based only; Realtime-ready.
- **Portal Access** — admin card: portal URL + email + copy, login activity
  (Last login / Never logged in / Account created), and Send welcome /
  Resend credentials / Reset password via the swappable email service.

Lifecycle guardrail respected: notifications never read `clients.status`;
roadmap stays the source of truth, Account Status stays the CRM label.

---

## 7. Known limitations / V2

See [ROADMAP.md](./ROADMAP.md). Headlines: Supabase Realtime (live cross-tab),
email notifications + branded Resend emails, pagination, auto-computed report
metrics, audit log/roles, Sentry + CI.

---

## 8. Recovery — bringing `main` back to true state

`main` is missing commits 9–14. Two ways to fix (pick one):

### Option A — Reset to the bundle (recommended, simplest)
The provided bundle's `claude/modest-darwin-zBsfw` branch is the full intended
state and is a content superset of your `main` (it includes the 0004 migration).
```bash
cd ~/bbettr-portal
git fetch <bundle-or-remote> claude/modest-darwin-zBsfw
git checkout main
git reset --hard FETCH_HEAD     # main now = full state
git push --force-with-lease origin main
```
You lose the standalone "Add notifications migration" commit object, but the
migration file is still present (it lives inside the notifications commit).

### Option B — One combined patch (keeps your history)
Apply the combined patch (everything in commits 9–14, **excluding** the 0004
migration you already have):
```bash
cd ~/bbettr-portal
git checkout main
git apply --3way bbettr-features-9-14.patch   # or: git apply
git add -A && git commit -m "Add asset-readiness, lifecycle cleanup, onboarding UX, notifications code, portal access"
git push origin main
```

### After either option
```bash
npm install && npm run build      # must pass
git ls-files | grep -E "readiness|seen-marker|portal-access|email/"
```
Then re-run [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md).

---

## 9. Next session

1. Confirm `main` = full state (commits 1–14 present) and Vercel deployed it.
2. Re-run the smoke test, then pick the next V2 item (Realtime is highest value).
3. Add Sentry + a CI action (typecheck/build on push) before more features.
