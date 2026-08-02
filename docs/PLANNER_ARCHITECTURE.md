# Planner Architecture

> Canonical engineering reference for the Bbettr OS **Planner** (meetings +
> calendar projection). Read this before changing anything under
> `src/lib/planner`, `src/lib/google/calendar`, the meetings UI, or the calendar
> migrations. It is a handbook, not API docs: it explains *why* the system is
> shaped the way it is and the rules you must not break.

---

## 1. Purpose

The Planner is the internal, **admin-only** operations module of the Bbettr
Portal (Bbettr OS). Today it manages **meetings** — a time window, a guest list,
and an optional Google Meet link — and projects them onto the agency's shared
Google Calendar. It lives behind the `PLANNER_ENABLED` flag and the `(admin)`
route group; clients and reps have zero access at every layer.

The Planner is part of the Portal, not a separate app. It reuses the Portal's
identity model (`public.profiles`, `is_admin()`), its Supabase clients, its
design system, and the shared integration primitives in `src/lib/net`.

> **Planner sources of truth.** This document is the *engineering* reference for
> the meetings/calendar Planner. Two companion documents govern the execution
> side and must both be conformed to by all future **Tasks**, persistence,
> services, APIs, automations, and UI work:
>
> - **Product behaviour** — [`docs/planner/execution-model.md`](./planner/execution-model.md):
>   the Planner-wide architectural principles ("pages are lenses, not stores"),
>   the one-question-per-page rule, the canonical task lifecycle, and the Today
>   page (Morning Planning, Current Focus, Waiting/Blocked, Quick Capture,
>   End-of-Day Review).
> - **Domain behaviour & invariants** — [`docs/planner/task-domain-architecture.md`](./planner/task-domain-architecture.md):
>   the headless Task Domain — concepts, boundaries, lifecycle enforcement,
>   scheduling, assignment/priority, dependencies/subtasks, events, atomicity,
>   authorization, and the tenant boundary.
>
> The Execution Model defines *how the Planner behaves*; the Task Domain
> Architecture defines *how the Tasks engine works*. Future work must conform to
> **both**.

**Why Google Calendar is an integration, not the primary system.** The Portal
must remain fully usable when Google is disconnected, slow, expired, or down.
If Google were the system of record, an outage would break scheduling — an
unacceptable coupling for an internal tool the team depends on. So Google is
treated exactly like QuickBooks or PayFast: an *optional projection target*. The
authoritative meeting lives in Postgres; Google is a convenience mirror that can
be rebuilt from Portal data at any time.

---

## 2. Core Architectural Principles

These are permanent invariants. They do not change between phases.

1. **The Portal database is the single source of truth.** Meetings and their
   attendees are authoritative in Postgres. Nothing is ever read back from
   Google into an authoritative field.
2. **Google Calendar is always a projection.** Every Google-side value
   (`google_event_id`, `etag`, `meet_url`) is a cache, never primary data.
3. **Google failures must never block Portal functionality.** Creating, editing,
   cancelling, deleting and viewing meetings all succeed regardless of Google's
   state. A Google failure only marks a projection row for later retry.
4. **Every Google projection must be reconstructable from Portal data.** Losing a
   calendar, changing accounts, or wiping the projection cache must never cause
   permanent data loss — a rebuild recreates the events.
5. **Synchronization is one-way (Portal → Google).** There is no authoritative
   inbound sync. Edits made directly in Google are *drift* and are corrected on
   the next reconcile.
6. **UI renders Portal state only.** The UI reads `Meeting` + `SafeProjectionView`
   and nothing else. No client-side sync inference, no polling, no Google calls.
7. **All synchronization is idempotent.** Any operation is safe to replay. Create
   uses a deterministic event id; reconcile skips no-ops via a content hash.
8. **All provider communication happens through the `CalendarProvider`
   abstraction.** No Google REST call exists outside `src/lib/google/calendar`.

---

## 3. System Architecture

```text
        Meetings Domain            (authoritative writes + reads; UI)
              │
      DesiredStateProvider         ("what SHOULD the event look like")
              │
              ▼
   Reconciliation Service / Engine (orchestration; provider-agnostic)
              │
     ┌────────┴─────────┐
     ▼                  ▼
 ProjectionStore    CalendarProvider (reflected cache) (Google REST)
              │
              ▼
          Scheduler                (drives due reconciliation on a cadence)
```

The **engine depends on exactly three interfaces** — `DesiredStateProvider`,
`ProjectionStore`, `CalendarProvider` — plus an injected logger and clock. It is
persistence-agnostic, provider-agnostic and scheduler-agnostic.

### Layer responsibilities (and what each must never do)

**Meetings Domain** — `src/lib/planner/meetings/*`
Owns the authoritative entity: validation, writes (server actions), reads
(queries), and the `SafeProjectionView`. Server actions do only:
validate → write Portal data → invoke the reconciliation service.
*Must never:* contain synchronization logic, call Google, or know about
`google_event_id`/etags.

**DesiredStateProvider** — `scheduling/desired-provider.ts`, implemented by
`meetings/desired-provider.ts`
Answers "what should this entity's event look like?" as a self-contained
`DesiredDraft` built entirely from Portal data.
*Must never:* read Google, or read the projection cache.

**Reconciliation Service / Engine** — `scheduling/service.ts` + `scheduling/reconcile.ts`
The service wires the concrete store + provider + logger + clock into the
engine (the single composition point). The engine decides create/update/delete,
manages the single-flight lock, computes the content hash, applies backoff, and
emits one structured log line per attempt.
*Must never:* import Supabase, import Google directly, or perform I/O outside its
injected dependencies.

**ProjectionStore** — `scheduling/store.ts` (interface),
`scheduling/supabase-store.ts` (impl)
Manages the *reflected cache* only: load/save projection rows, acquire/release
the lock, update sync metadata, record sanitized failures, list due/all rows,
and prepare rows for rebuild.
*Must never:* be exposed to the UI, or load desired state (that is the
DesiredStateProvider's job).

**CalendarProvider** — `scheduling/types.ts` (interface),
`google/calendar/service.ts` (impl)
Implements the four provider operations (create / update / delete / reconcile)
against a real calendar. Handles provider-specific quirks: deterministic ids,
409/412/404 semantics, Meet conference requests.
*Must never:* touch the database, or contain meetings-domain logic.

**Scheduler** — `scheduling/scheduler.ts`, adapter at
`app/api/planner/reconcile/route.ts`
A tiny `tick()` abstraction that runs one due-reconciliation pass. The manual
"Reconcile now" button and the scheduled cron both call the same `tick()` — one
execution path.
*Must never:* be bypassed by callers issuing their own reconciliation loop.

---

## 4. Data Model

All tables are additive and isolated (migrations `0029`–`0032`). They touch no
existing Portal table.

### `meetings` (authoritative)
The meeting itself: `title`, `description`, `starts_at`/`ends_at` (timestamptz,
UTC instants), `time_zone` (IANA), `has_meet`, `status` (`scheduled` |
`cancelled` — no speculative states), soft-delete `deleted_at`, server-stamped
audit (`created_by`, `cancelled_by/at`, immutable `created_at`), and
`idempotency_key` (partial-unique, for replay-safe creation).
**Authoritative.** This is the source of truth for a meeting.

### `meeting_attendees` (authoritative)
Normalized guest list: `meeting_id` (FK, cascade), `email`, `display_name`.
There is intentionally **no `is_organizer`** — the connected agency account is
the organizer by definition; attendees are guests. RSVP state lives in Google
and is non-authoritative.
**Authoritative** (the intended guest list).

### `calendar_projections` (reflected cache — service-role only)
One row per projected entity: `entity_type`/`entity_id` (polymorphic, no FK),
`google_calendar_id`, `google_event_id`, `id_epoch` (rebuild namespace), `etag`,
`meet_url` + explicit `meet_state` (`not_requested`|`pending`|`ready`|`failed`) +
`last_meet_error`, `sync_state`
(`not_applicable`|`pending`|`synced`|`failed`|`disconnected`), `synced_hash`,
`sync_attempts`, `next_attempt_at`, `locked_at`+`lock_token` (single-flight),
`last_sync_at`, `last_sync_error`.
**NOT authoritative — a rebuildable cache.** RLS is enabled + forced with no
policies; only the service-role (secret key) can read/write it.

### `calendar_credentials` (secret store — service-role only)
Single-row (`id = 1`) shared Google OAuth credential: `status`, metadata, and the
AES-256-GCM-encrypted `refresh_token_enc`. No event data.
**Authoritative for the connection**, but never exposed: RLS forced with no
policies, service-role only, ciphertext only.

Error columns (`last_sync_error`, `last_meet_error`) hold **sanitized codes
only** — never tokens, bodies, attendee data or stack traces.

---

## 5. Synchronization Lifecycle

Desired state comes from the `DesiredStateProvider`; the engine reconciles it
against the `ProjectionStore` via the `CalendarProvider`.

### Create
Server action validates → inserts the meeting (with idempotency key) →
inserts attendees → invokes `reconcileMeeting(id, correlationId)`. The engine
ensures a projection row, acquires the lock, and calls `provider.reconcile`,
which **creates** a Google event under the deterministic id
`f(entity_id, id_epoch)`. A duplicate id (409) is adopted as success. The write
commits **before** the projection attempt; the attempt is bounded (single
provider call) so the action never hangs.

### Update
Editing bumps nothing on Google directly. The action rewrites the meeting +
attendees, then reconciles. The engine recomputes the desired hash; if it
differs from `synced_hash`, `provider.reconcile` **patches** the existing event
(etag-guarded). An etag mismatch (412, external drift) is overwritten — Portal
wins. A vanished event (404/410) is recreated under the same id.

### Delete
Soft-delete sets `deleted_at`; the desired intent becomes `deleted`. Reconcile
**deletes** the Google event (404/410 = already gone), then clears
`google_event_id`. Cancelling (`status='cancelled'`) first patches the event to
`cancelled` (so attendees are notified per `GOOGLE_CALENDAR_SEND_UPDATES`), then
removes it.

### Reconcile
`reconcilePending(limit)` selects due rows (`pending`/`failed`, past
`next_attempt_at`, unlocked) and runs each through `projectEntity`. It is
idempotent and replay-safe: a `synced` row whose desired hash is unchanged and
whose Meet is not mid-provisioning is a no-op. Transient failures back off and
stay retryable; auth failures move the row to `disconnected`.

### Rebuild
`rebuildProjections` enumerates **only Portal-managed** projection rows, resets
each (safe in-place re-sync by default; `freshIds` advances `id_epoch` for the
calendar/account-change case), and drives the normal reconcile. It never touches
events we hold no projection for, is replay-safe, and returns a **structured
audit summary** (`processed`/`rebuilt`/`skipped`/`failed`/`durationMs` + per-item
sanitized reasons).

---

## 6. Failure Handling

The guiding rule: a Google failure is recorded, never propagated into a Portal
render or a user action.

- **Google is offline / APIs unavailable.** Outbound calls time out
  (`AbortSignal.timeout`, ~8s). Transient failures (timeout, network, 429, 5xx)
  are retried by the scheduler with exponential backoff; the row stays
  `failed`/`pending`. Meetings remain fully usable; the status reader does no
  network I/O.
- **OAuth expires / refresh fails (`invalid_grant`).** The projection moves to
  `disconnected` and pauses; the shared credential is flagged
  `reconnect_required`. On reconnect, `disconnected` rows reconcile.
- **Timeouts.** Bounded per call. The inline post-commit attempt is a single
  shot (no retries) so an action never hangs; the scheduler handles retries.
- **Duplicate requests (refresh / retry / double-click).** Creation is
  idempotent: the client sends a stable `idempotency_key` (persisted in
  sessionStorage), and the partial-unique index + re-read guarantee at most one
  meeting. Projection create is idempotent via the deterministic event id.
- **Rebuild required (cache loss / calendar or account change).** Run rebuild.
  In-place re-sync repairs drift with no duplicates; `freshIds` re-creates under
  a new id namespace when old ids can't be reused. Everything is reconstructable
  from Portal data.

---

## 7. Security Model

- **RLS.** `meetings` and `meeting_attendees` are admin-only (`is_admin()`
  policies; no delete policy on meetings → soft-delete). `calendar_projections`
  and `calendar_credentials` have RLS **enabled + forced with no policies** —
  unreachable by anon or any authenticated session, including admins. Proven by
  the standalone RLS harness (41/41).
- **Service-role usage.** Only the projection engine and the credential/loader
  code use the service-role (secret-key) client, exclusively in trusted server
  code, to reach the RLS-locked tables. Never imported into a client component.
- **Encrypted credentials.** The Google refresh token is stored AES-256-GCM
  encrypted (`GOOGLE_TOKEN_SECRET`), ciphertext only, decrypted only in trusted
  server code immediately before use.
- **Sanitized logging.** Every sync attempt logs `correlationId`, entity type/id,
  calendar id, event id, operation, duration, result and a **sanitized reason
  code**. Never event descriptions, attendee details, tokens or raw bodies.
- **Correlation IDs.** Exactly one id per user action (or scheduler tick) is
  generated (or reused from context) and propagated Server Action → Service →
  Engine → CalendarProvider, so every log line from one action shares it.
- **Idempotency.** Application-level for creation (key + unique index) and
  provider-level for projection (deterministic id, 409-adopt).
- **Projection isolation.** The UI receives only a `SafeProjectionView`
  (`sync_state`, `meet_state`, `meet_url`, `last_sync_at`). Raw projection rows —
  etags, locks, `id_epoch`, error payloads — never leave the server. The
  scheduled endpoint is protected by a shared bearer secret; absent secret ⇒ it
  is disabled, never open.

---

## 8. Extension Points

Add capability by implementing an interface or adding an adapter — never by
reaching around the architecture.

- **Another calendar provider.** Implement `CalendarProvider` (create / update /
  delete / reconcile) in a new `src/lib/<provider>/calendar` module and select it
  in the reconciliation service. The engine and store are unchanged.
- **Another scheduler.** Implement the `Scheduler` interface (or point a new
  trigger at the internal reconcile endpoint). Both call the same `tick()`; the
  engine is untouched.
- **Another persistence backend.** Implement `ProjectionStore` (and, if desired
  state moves, `DesiredStateProvider`). Swap it in the service's `buildDeps`.
  The engine has no Supabase knowledge to change.
- **Recurring meetings.** Implement Portal-side materialization: expand a
  recurrence rule into concrete meeting rows over a rolling horizon; each
  occurrence is an ordinary syncable entity. The schema reserves `id_epoch`; add
  `recurrence_rule` + `series_id`. Do not push RRULE state as authoritative into
  Google.
- **Multi-calendar.** `calendar_projections.google_calendar_id` is already
  per-row. Add a per-meeting calendar selector (desired state) and a `calendars`
  registry; the engine already targets a calendar id per operation.
- **Multi-account.** Evolve `calendar_credentials` from single-row to keyed-by-
  account; give `getAccessToken(account)` a selector; expand the `account.ts`
  policy to an allowlist. The token/crypto core is unchanged.

---

## Production Hardening (Phase 3.1)

Four production-readiness improvements landed after the audit. None changed the
architecture or any public contract behaviour.

- **Access-token cache (provider-local).** `src/lib/google/calendar/token-cache.ts`
  holds one access token + expiry in memory and reuses it for all calendar
  operations, refreshing only within a 5-minute window of expiry. Refresh-token
  behaviour is unchanged (a cache miss still runs the full refresh, including
  `invalid_grant → reconnect_required`); a 401/403 invalidates the cache so the
  next call refreshes. This removes the previous one-token-refresh-per-operation
  cost.
- **Meet-pending refresh via GET, not PATCH.** When a projection is already
  `synced`, its hash is unchanged, and only `meet_state = 'pending'` remains, the
  engine issues a provider **read** (GET) to pick up the Meet URL — it no longer
  PATCHes the event, so guests are never re-notified under `sendUpdates=all`.
- **Scheduler time budget.** `reconcilePending` accepts `maxDurationMs`
  (`PLANNER_RECONCILE_MAX_MS`, default 8s). A pass stops **between** entities once
  the budget is spent — never mid-entity, so there are no partially processed
  entities — and leaves the rest pending for the next tick. Locking is unchanged.
  The route sets `maxDuration`; recommended cron interval is every 2–5 minutes
  (≥ 2× the budget).
- **Atomic meeting creation.** `create_meeting_with_attendees` (migration 0033, a
  SECURITY INVOKER RPC) inserts the meeting and its attendees in one transaction —
  both commit or neither does. RLS, the audit trigger and the idempotency key are
  all preserved.

## 9. Non-Negotiable Rules

Violating any of these breaks the architecture. Do not merge code that does.

- [ ] **Never make Google the source of truth.** Postgres is authoritative;
      Google is a projection.
- [ ] **Never read Google state back into an authoritative Portal field.**
- [ ] **Never let a Google failure fail a Portal write or a page render.**
- [ ] **Never bypass the reconciliation engine** to talk to a calendar directly
      from a domain/action/UI.
- [ ] **Never expose `ProjectionStore` (or raw projection rows) to the UI.** The
      UI sees only `SafeProjectionView`.
- [ ] **Never write Google-specific logic inside the meetings domain.** Provider
      code lives only under `src/lib/google/calendar`.
- [ ] **Never bypass the `Scheduler`** — manual and scheduled reconciliation use
      the same `tick()`.
- [ ] **Never couple the engine to Supabase** (or any concrete store/provider).
      It depends only on its three interfaces + logger + clock.
- [ ] **Never perform synchronization during page rendering.** Rendering is
      read-only; sync happens in actions and the scheduled trigger.
- [ ] **Never start an unawaited projection promise after an action** — awaited
      and bounded, or via the scheduler. No fire-and-forget.
- [ ] **Never log or persist secrets or payloads.** Errors are sanitized codes;
      tokens are encrypted; logs carry safe fields only.
- [ ] **Never make a projection non-reconstructable.** Rebuild from Portal data
      must always be a valid, safe operation.
- [ ] **Never widen access to the RLS-locked tables** (`calendar_projections`,
      `calendar_credentials`) — service-role only, forever.
