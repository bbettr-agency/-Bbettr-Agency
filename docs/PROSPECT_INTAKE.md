# Prospect Intake Programme (P2) — Authoritative Spec

_Single source of truth for the public/shareable prospect-intake feature. This
supersedes chat-history context: the programme no longer depends on conversation
memory._

Production domain: https://portal.bbettragency.com · Public entry: `/start`

---

## Purpose

A prospect is **not** a client. This programme lets prospects complete a light,
sales-stage intake through a public link — a **generic** `/start` link or a
**personalised** `/start/<token>` link — and land their answers as a
`prospect_intakes` row that is **structurally separate** from `clients`. There is
**no** account, tenant, portal login, or onboarding project created. Turning a
prospect into a client is a deliberate, later admin action (**P4 — not built**).

Stack: Next.js 15 (App Router) · TypeScript · Tailwind · Supabase (Postgres + RLS)
· Vercel (auto-deploys `main`).

---

## Programme status

| Slice | Scope | State |
|---|---|---|
| **P1** | `prospect_intakes` table + token model + lifecycle (migrations `0058`, `0059`) | ✅ merged, migrated to prod |
| **P2-A** | Public shell + intro (`/start`) | ✅ merged |
| **P2-B** | Pure schema / validation / normalization (no I/O) | ✅ merged |
| **P2-C** | Secure server: Turnstile, honeypot, token resolution, autosave, **versioned CAS submit**, notification | ✅ merged |
| **P2-D** | Interactive six-section flow + resume + review + submit UI | ✅ merged |
| **P2-E** | **Stale/expired draft cleanup** (this doc) | ⏳ active slice |

Anything beyond P2-E — analytics, admin Intakes UI, prospect→client conversion,
rate limiting — is **out of the P2 programme** (see Exclusions).

---

## Data model (migration 0058 / 0059 — already in production)

`public.prospect_intakes`:
- `id uuid pk`, `token_hash text unique` (SHA-256 hex, len 64 — the raw token is
  **never** stored), `token_expires_at timestamptz` (30-day TTL),
  `source text ('generic'|'personalised')`,
  `status text ('draft'|'submitted'|'converted'|'dismissed')` default `draft`,
  promoted columns `business_name/contact_name/email/phone`,
  `selected_services text[]` (subset of `website,google_ads,meta_ads,seo`),
  `data jsonb` (canonical answers, source of truth),
  `converted_client_id uuid` (idempotency guard for P4), timestamps
  `created_at/updated_at/submitted_at/converted_at`.
- `updated_at` is bumped by a `BEFORE UPDATE` trigger (`set_updated_at`).
- **RLS:** admins manage all; **no client policy; anon fully denied.** Every
  public read/write happens via a **service-role** server action *after* token
  validation — never via anon RLS.

Lifecycle: `draft → submitted → converted` (P4); `draft|submitted → dismissed`
(admin). `converted`/`dismissed` are terminal. Token capability by state:
draft = read+mutate; submitted = read-only; converted/dismissed/expired = closed.

---

## P2-E — Stale/Expired Draft Cleanup

### Objective
Periodically **hard-delete** prospect drafts whose token has expired and were
never submitted. This is **data minimisation** (removes the PII of prospects who
never submitted and whose link is already dead) and prevents table/admin bloat.
Small and focused — cleanup only. No UI, no analytics, no schema change.

### Exact stale-draft predicate
A row is eligible for deletion **iff**:

```
status = 'draft' AND token_expires_at < now()
```

Nothing else is ever deleted. In particular `submitted`, `converted`,
`dismissed`, and any **non-expired** draft are always preserved, regardless of age.

### Lifecycle behaviour
- Eligible rows are **hard-deleted** (row removed). No new lifecycle status is
  introduced; drafts are not soft-closed to `dismissed` (that state is reserved
  for admin dismissal and would retain PII).
- No effect on any non-eligible row. No prospect or admin notification is sent
  when an expired draft is deleted.
- Deletion is guarded at the mutation boundary: the DELETE re-asserts
  `status='draft' AND token_expires_at < now()`, so a row that changed state
  between selection and deletion is never removed.

### Security model
- Runs **server-side only** via the existing **service-role** pattern
  (`createAdminClient`), never from the browser and never via anon RLS.
- Exposed as a protected **application cron/API route**
  (`POST /api/prospect-intakes/cleanup`) authorised by a **dedicated bearer
  secret** `PROSPECT_CLEANUP_CRON_SECRET` (mirrors the planner reconcile route):
  - secret **absent → 503** (fail closed; the endpoint is never open),
  - wrong/missing bearer → **401**,
  - correct bearer → cleanup runs.
- Failures return a **generic** error; Supabase/database internals, row ids, and
  token hashes are never exposed in the response.
- **No RLS change**, no schema change, no new lifecycle status.

### Scheduler / cron approach
- An external scheduler (Vercel Cron or equivalent) issues an authenticated
  `POST` to the route on a low cadence (daily is ample). **`pg_cron` is NOT
  used.** Swapping schedulers changes only who calls the route.
- The run is **idempotent** (a second run deletes nothing new) and **bounded**:
  it deletes in batches with a max-iterations cap so a large backlog cannot run
  unboundedly or exceed the function budget; the remainder drains on the next tick.

### Tests required
- **Pure** (`intake-cleanup.ts`, vitest): `isStaleDraft` truth table; `runCleanup`
  against a fake store — deletes only eligible rows, idempotent re-run, batching +
  cap; `authorizeCleanup` — 503 (no secret) / 401 (wrong) / ok (correct).
- **DB proof** (`.mjs` against disposable local Postgres, existing 0058 schema):
  seed expired-draft, non-expired-draft, expired-submitted, expired-converted,
  expired-dismissed → run the exact DELETE → assert **only** the expired draft is
  gone and all others remain → re-run proves idempotency (0 further deletions).
- Route-level: 503/401 paths (short-circuit before any DB access).

### Explicit exclusions (P2-E)
- ❌ Analytics / funnel tracking of any kind.
- ❌ Rate limiting / Redis.
- ❌ Monotonic-integer CAS version change (the `updated_at` CAS residual is an
  accepted risk; unchanged).
- ❌ Admin Intakes UI; prospect→client conversion (P4); client/tenant/portal/
  onboarding creation (P3/P4).
- ❌ Any change to P2-D intake UX or reopening of P2-C/P2-D (absent a genuine
  regression).
- ❌ No migration (the app-route + service-role design needs no schema change).

---

## Deployment gate (all slices)

The public write path (draft create + submit) **fails closed** without Turnstile
env in Vercel production: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` +
`TURNSTILE_SECRET_KEY`. P2-E additionally needs `PROSPECT_CLEANUP_CRON_SECRET`
set (and a scheduler configured to call the route) before cleanup runs; until
then the endpoint is disabled (503), which is safe.

## Security invariants (must always hold)
No anon Supabase writes · no direct browser→Supabase mutation · service-role
server-only · raw token never persisted (hash only) · non-enumerating public
errors · no PII/token in logs or analytics · Turnstile required on create+submit
(fail closed), never on autosave · honeypot present · `_prefill` server-owned and
non-patchable · promoted columns derived server-side · submitted/expired/terminal
rows never mutated · submit is a versioned CAS (exactly one draft→submitted;
notification exactly once).
