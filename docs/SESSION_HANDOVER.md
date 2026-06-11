# Session Handover — Bbettr Agency Client Portal

_Last updated: 2026-06-11 · Production: https://portal.bbettragency.com_

This is the single source of truth for picking the project back up. All project
docs live under [`docs/`](./).

---

## 🏁 MILESTONE — Sales Rep Portal **V1 complete** (2026-06-11)

**This is the stable baseline to build on before QuickBooks Phase 2 begins.**
Work lives on branch `claude/rep-portal-stabilise` @ `603c566`, delivered as a
sequence of patches to apply to `main`. Verified on every patch: `tsc` ✅ ·
`lint` ✅ · `build` ✅.

### Current production status
- **Base `main` deployed:** `19f465f` — Sales Rep Portal **Phase 1**, internal
  notifications, Resend email, maintenance mode, full client portal/admin OS.
- **Rep Portal V1 completion** is delivered as the **4 patches below** (applied
  to `main` in order + deployed by the operator). They are **not** auto-merged
  to remote `main`; the operator applies/deploys them.
- **Migrations in production:** `0001`–`0008` on base `main`; **`0009_rep_portal_hardening`**
  ships with patch ①. No other rep migrations.

### Rep Portal V1 — deployed/complete features
- **Roles & access:** `rep` role, role-aware routing, login → `/rep`. Reps can't
  reach admin/client surfaces; **deactivated reps are fully blocked** (branded
  "Account Deactivated" screen + blocked from submitting deals).
- **Rep portal:** Dashboard (Total Deals / Commission Earned / Awaiting Approval,
  This-Month + Lifetime, Recent Activity) · My Deals (filters: All/Pending/
  Approved/Rejected) · New Deal (price required & > 0) · My Earnings
  (Total / This-month / Approved deals / **Unpaid** Commission + monthly table).
- **Admin → Reps:** create rep (+login, temp-password shown once), activate/
  deactivate, reset password, **welcome email with login URL + email + temp
  password**, per-rep Sales Value & Commission Total, **Delete Rep** (testing —
  see below), and **correct invoice-request status** on the rep detail page.
- **Admin → Invoice Requests:** approve (records commission, rate from the rep) /
  reject (with confirm step); guarded so only `pending` can be actioned.
- **Notifications (in-app bell):** rep submits → **admins** get an unread blue
  dot; admin approves/rejects → the **rep** gets one. Recipient layout is
  revalidated so the badge actually appears.
- **Emails (Resend, best-effort):** rep welcome credentials; submit → email to
  `info@bbettragency.com`; approve/reject → email to the rep. Reuses the shared
  Resend sender + branded template (no change to client email logic).
- **RLS hardening:** dropped the unused `"Reps update own deals"` policy.

### The patch set (apply in this order)
| # | Patch | Adds | Migration |
|---|---|---|---|
| ① | `fix-rep-portal-stabilisation.patch` | P1/P2/P3 audit fixes (deactivation enforcement, reject guard, price validation, relabels, polish) | **`0009_rep_portal_hardening.sql`** (drop policy) |
| ② | `add-delete-rep.patch` | Delete Rep button + history-guarded delete | — |
| ③ | `delete-rep-bypass-history-guard.patch` | **TESTING-ONLY** bypass of the history guard | — |
| ④ | `fix-rep-portal-final.patch` | Welcome-credentials email, bell revalidation, sales-flow emails, rep-detail status | — |

> Patches ①→④ are sequential and share files. ④ does **not** apply on a bare
> `origin/main` — it requires ①–③ first (verified). `RESEND_API_KEY` must be set
> for emails to send (they degrade gracefully if absent).

### ⚠️ Known TEMPORARY testing-only item — Delete Rep bypass
Patch ③ **removes the historical-data guard** on `deleteRepAction` so test reps
can be wiped repeatedly. With it gone, deleting a rep **permanently cascades
away all of their data** (auth user → profile → reps, deals, invoice_requests,
commissions, internal_notifications). The code is marked:
`"Testing-only behaviour. Restore historical-data protection before production
launch."`
**Before production:** restore the guard (block delete when the rep has deals /
invoice requests / commissions) or swap in the planned **Archive Rep** workflow.

### QuickBooks — NOT deployed
QuickBooks **Phase 2 is built but UNDEPLOYED** on a separate branch
(`claude/modest-darwin-zBsfw`). Its migration was drafted as `0009` and **must be
renumbered to `0010`** now that `0009` is rep-portal hardening. **Do not start /
deploy QuickBooks without explicit approval.** This milestone is the baseline to
review it against.

### Migration numbering (important)
Production runs `0001`–`0008`; this milestone adds **`0009_rep_portal_hardening`**.
The QuickBooks migration (currently `0009` on its branch) must become **`0010`**.

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
