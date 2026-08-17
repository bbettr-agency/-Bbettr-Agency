# Session Handover — Bbettr Agency Client Portal

_Last updated: 2026-08 — Feature A (Client Billing Details) shipped · Production: https://portal.bbettragency.com_

This is the single source of truth for picking the project back up. All project
docs live under [`docs/`](./).

> **Read the "CURRENT CHECKPOINT" section immediately below first.** Everything
> from "## 1. What was built" onward is HISTORICAL context (pre-Planner era,
> ~mid-2026) and no longer reflects current production state.

---

## ⭐ CURRENT CHECKPOINT — Planner + Meetings + Billing era (resume here)

### Where we are right now
- **`main` = `58eb30f`** (== `origin/main`), working tree clean.
- **Production database migration history: through `0055`.** Production app is
  **deployed** and current with `main`.
- **Feature A — Client Billing Details is COMPLETE**: merged, migration `0055`
  applied to production, deployed, and **manually tested & confirmed working** by
  Eloff. Treat Feature A as done unless Eloff explicitly asks for changes.

### Recently completed & shipped (all merged, migrated, deployed, manually tested)
1. **Public self-service meeting rescheduling — "Slice D"** — migration **`0053`**.
   No-show follow-up email issues a secure single-use tokenized link; public
   `/reschedule/[token]` page shows verified availability (BUSINESS ∩ PORTAL ∩
   GOOGLE `events.list`, **fail-closed**); atomic `confirm_meeting_reschedule()`
   moves the SAME Google event (no duplicate); token consumed on use.
2. **Post-meeting lifecycle** — migration **`0054`**. Derived states
   Upcoming / Needs-outcome / Completed / No-show / Cancelled (precedence
   cancelled→no_show→completed→needs_outcome→upcoming). Completion is an
   annotation (`attended_at`), NOT a status. Mark-attended retires the reschedule
   token + is inert to Google; optional per-recipient follow-up emails (honest
   delivery, never rolls back completion); internal `outcome_notes` (≤4000, never
   emailed/projected); Calendar tabs with a prominent "Needs outcome" count.
3. **Client Billing Details — Feature A** — migration **`0055`**. ONE client-level
   billing profile (`public.client_billing_details`, PK `client_id`, 1:1, shared
   across all services — never per-service copies). Partial saves allowed
   (`validateBillingDraft`); the shared onboarding **final-submit gate**
   (`saveOnboarding` when `submit=true`) requires a complete profile via
   `isBillingComplete` (invoice_name + effective email); same-as-contact resolves
   from `clients.contact_email`; cross-service prefill; admin Billing Details
   card + edit modal; own-row RLS (client writes own; `client_id` from session,
   never browser); whitelisted `BillingDetailsView` (no leakage); zero backfill.

### Migration ledger (production is at 0055)
| # | File | Feature | Prod applied |
|---|---|---|---|
| 0053 | `0053_meeting_no_show_reschedule.sql` | Self-service reschedule | ✅ |
| 0054 | `0054_meeting_completed_lifecycle.sql` | Post-meeting lifecycle | ✅ |
| 0055 | `0055_client_billing_details.sql` | Client billing details | ✅ |

DB proofs: `npm run test:tasks-0053` (40/40), `test:tasks-0054` (33/33),
`test:tasks-0055` (40/40). Also `test:rls` (56/56), `test:parity`, and the full
`npm run test` (Vitest) all green on `main`.

---

## ⏭️ NEXT FEATURE — Feature B: Task Completion / Progress Scale (DO NOT START YET)

**Requirement:** show how far a task has progressed (0 / 25 / 50 / 75 / 100 %) so
the team can see another person's progress at a glance without asking. Audit +
design are **already complete**; implementation is **not started**.

### Locked design direction (from the completed audit)
- Own migration **`0056`** + its own DB proof. **Never combine with 0055.**
- Progress lives in the existing **Planner task architecture**. Tasks are
  **event-sourced / command-driven** — the ONLY writer is the service-role
  `apply_task_command` RPC (migration 0046) fed by the pure TS state machine.
  **Do NOT implement progress as a direct `UPDATE public.tasks`.**
- `progress` = **smallint, discrete** CHECK `in (0,25,50,75,100)`.
- **100% corresponds to completion** — not an independent contradictory state.
  Existing completed tasks must never display 0%.
- Recurrence / reminders / assignments / due dates / notifications stay
  **inert** unless explicitly required. **No meeting/calendar code touched.**
- Recurrence note: generated instances inherit table DEFAULTs for columns the op
  CREATE insert doesn't enumerate → a `progress` default flows to recurring
  instances for free (must be DB-tested).
- Event-log note: `task_events.event_type` is a fixed CHECK vocabulary; a
  `TaskProgressChanged` event requires widening that CHECK + the `read_task_events`
  (0047) summary/payload whitelist — careful review needed.

### OUTSTANDING decisions to RECONFIRM with Eloff before implementing
1. **Existing data** — recommended: `progress` **nullable** for historical rows,
   **DEFAULT 0** for new tasks, UI derives historical *completed* rows as 100%.
   **No speculative backfill.**
2. **100%** — recommended: 100% **only via Complete**; manual SetProgress =
   {0,25,50,75}; CompleteTask atomically sets `progress=100` (+ existing
   `completed_at`/`completed_by`). No second completion pathway from the slider.
3. **Reopen** — recommended: reopening a completed task → `planned`, **progress
   reset to 75%**. ⚠️ RECONFIRM.
4. **Event history** — recommended: add `TaskProgressChanged` (widen event CHECK +
   read model). ⚠️ RECONFIRM (enlarges the migration; touches core read models).
5. **Inbox** — recommended: SetProgress **excluded from inbox**; allowed on active
   states (planned/scheduled/in_progress/waiting). ⚠️ RECONFIRM exact legality.
6. **UI** — compact progress chip on task rows + detail/edit; visible at a glance
   on My Tasks / Team / Today; completed tasks show 100%.

Also enforce, at both the state-machine/op layer AND a DB CHECK (defense-in-depth),
that the forbidden states are impossible: **completed + progress≠100** and
**open/active + progress=100**.

### Feature B build slices (each STOPs for approval)
- **B1** — final audit/reconfirmation → author `0056` migration → DB proof → **STOP**.
- **B2** — state machine `SetProgress` + op/RPC integration + actions/types +
  Complete/Reopen progress invariants + tests → **STOP**.
- **B3** — UI across task surfaces + progress controls + tests + adversarial
  review → **STOP for merge approval**.

---

## 🔒 Working process (gated — do NOT skip a stop point)

`audit/design → approval → migration + DB proof → STOP → application slice →
tests → adversarial review → merge approval → --no-ff merge → production migration
dry-run → separate approval → db push → deployment → manual production testing.`

**Never automatically:** merge · `db push` · deploy · create additional
migrations · start the next slice — each needs Eloff's explicit approval.

### First actions for the NEXT Claude Code session (before any code)
1. Read this handover (this CURRENT CHECKPOINT section).
2. Inspect `main` / `origin/main` (`git fetch origin main`; both should be `58eb30f`
   unless newer approved work merged since).
3. Verify production/code assumptions against the repo (migration ledger, gates).
4. Tell Eloff exactly where we stopped.
5. **Reconfirm the outstanding Feature B decisions (§ above, items 1–6).**
6. Wait for explicit approval before writing any code. Do NOT db push / deploy /
   start Feature B / create a migration without approval.

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
