# Phase 3 Architecture — Scheduling & Google Calendar Projection

**Status:** Approved (design only). Implementation proceeds separately on
`planner-phase-3` after the implementation plan is approved.

Bbettr OS Phase 3 adds meetings and projects scheduled Portal items onto the
shared agency Google Calendar (with Google Meet). This document is the approved
architecture and the contract every future calendar work must honour.

---

## Foundational decisions (locked)

- The **Portal database is the single source of truth**.
- **Google Calendar is a projection only, never authoritative.**
- Synchronization is **one-way: Portal → Google**.
- The **"Google must fail independently" invariant is non-negotiable** — the
  Portal remains fully usable when Google is disconnected, slow, expired, or
  unavailable.
- **Every Google projection must be reconstructable from Portal data alone.**

## Core architectural principles

### 1. Projection Contract
Every calendar provider must support the same four operations, and nothing more
is assumed of it:

- **Create** — materialise a Portal item as a provider event.
- **Update** — bring an existing provider event to match the Portal item.
- **Delete** — remove the provider event.
- **Reconcile** — make provider state match desired Portal state, idempotently,
  from Portal data alone, regardless of current provider state.

Google is the first implementation of this contract. Any future provider
(another calendar system) implements the same four operations; the scheduling
core depends only on this interface, never on Google specifics.

### 2. Sync Ownership
The **Portal is the authoritative owner of every projected event.** Projection
is one-way (Portal → Google). Any change made directly in Google is **drift**:
it is never imported as authoritative and is **corrected on the next
reconciliation** (Portal desired state overwrites Google). Attendee RSVP state
lives in Google and is explicitly non-authoritative in the Portal.

### 3. Reconstructability
Every Google Calendar event must be **fully reproducible from Portal data**.
The Portal stores everything needed to (re)create an event — title, timing,
time zone, attendees, Meet flag, target calendar — independent of any value read
back from Google. Consequences:

- Losing a calendar, changing Google accounts, or switching calendars must
  **never cause permanent data loss** — the events are rebuilt by reconciliation
  from Portal rows.
- Google-side identifiers (`google_event_id`, `meet_url`, `etag`) are **caches
  of a projection**, not primary data. They can be cleared and regenerated.
- A full re-projection ("rebuild the calendar") is always a valid, safe
  operation.

### 4. Observability
Every synchronization attempt emits a **structured log line** (building on the
Phase-2 `logIntegrationEvent`), containing at minimum:

| Field | Meaning |
|---|---|
| `correlationId` | Ties one sync attempt end to end |
| `entityType` + `entityId` | The Portal entity being projected (e.g. `meeting:<uuid>`) |
| `googleEventId` | The Google event id, when available |
| `operation` | `create` \| `update` \| `delete` \| `reconcile` |
| `durationMs` | Wall-clock duration of the provider call(s) |
| `result` | `success` \| `failure` \| `skipped` |

Failures additionally carry a safe `reason` (typed-error class / `invalid_grant`
/ `timeout`) — never tokens, bodies, or secrets. These lines make every
projection attempt auditable and support drift/latency investigation.

---

## Entities & data model (design sketch — no code)

A single **"syncable item"** abstraction unifies projection. Both entity types
expose the same projection shape; one reconciler drives both.

- **`meetings`** (new, Phase 3) — first-class calendar events: `title`,
  `description`, `starts_at` (timestamptz), `ends_at`, `time_zone` (IANA),
  `has_meet` (bool), attendees (see below), plus the sync columns. Meetings are
  historical entities (they are "held", not "completed") and are handled
  independently of tasks.
- **`tasks`** (existing, Phase 1) — internal to-dos. A task is calendar-relevant
  **only** when it has a scheduled time and sync is enabled. Meeting-specific
  concepts (attendees, Meet, scheduling metadata) are **never** added to `tasks`.

**Shared sync columns** (on any syncable row):
`google_calendar_id`, `google_event_id` (nullable), `meet_url` (nullable),
`etag` (nullable), `sync_state` ∈ `{ not_applicable, pending, synced, failed,
disconnected }`, `sync_version` (monotonic), `content_hash`, `sync_attempts`,
`last_sync_at`, `last_sync_error`.

**Recurrence-ready (designed, not built):** nullable `recurrence_rule` +
`series_id` reserved so recurrence can later be added as Portal-side
materialisation without reworking the core.

---

## Synchronization behaviour

### Source of truth
Portal Postgres is canonical. Google stores a *reflection*. No authoritative
field is ever read back from Google.

### Synchronization model
One-way, outbound, best-effort reconciliation of *desired state* (Portal row)
vs *reflected state* (Google event). The user action **commits the Portal row
first and returns success independent of Google**; the projection is attempted
**after commit** and its outcome only updates the sync columns — it never gates
or delays the user. Failed/`pending` rows are brought to `synced` by the
**reconciler**, which is idempotent and safe to replay at any time (D2).

### Event lifecycle
| Portal state | Reconciler action | Result |
|---|---|---|
| created + scheduled, `pending` | Create (deterministic id) | `synced`, ids stored |
| edited (`sync_version` bumped) | Update (PATCH, etag-guarded) | `synced` |
| task completed | Delete projected event | event removed, row retained (D3) |
| meeting cancelled | set event `status=cancelled` (notify), archive | removed after notice |
| soft-deleted (`deleted_at`) | Delete (`404/410` = success) | `google_event_id` cleared |
| `invalid_grant` | halt, mark `disconnected` | resumes on reconnect |
| transient failure | leave `pending`/`failed`, backoff | retried |
| orphan (event exists, row gone) | Delete on sweep | removed |

### Idempotency
- **Create:** the Google event `id` is derived **deterministically from the
  Portal row UUID** (base32hex). A duplicate insert returns `409` → treated as
  success. Create is therefore safe to replay even after a timed-out attempt
  that actually created the event.
- **Update:** PATCH is idempotent; no-op patches skipped via `content_hash`;
  `etag` + `If-Match` for optimistic concurrency.
- **Meet:** deterministic `conferenceData.createRequest.requestId` per meeting.

### Duplicate prevention
Deterministic client-assigned event id (Google enforces uniqueness) · DB
invariant one row ↔ one `google_event_id` · per-row single-flight lock so
concurrent reconcilers can't both create · deterministic Meet `requestId`.

### Retry strategy
Reuse Phase-2 `withRetry` / `isTransientIntegrationError`: retry only transient
(timeout, network, 429, 5xx); never 4xx / `invalid_grant` / consumed requests.
Per-attempt backoff bounded; on exhaustion the row stays `failed`/`pending` with
`sync_attempts++` and a growing backoff so a bad row can't hot-loop.
`invalid_grant` → credential `reconnect_required`; on reconnect, `disconnected`
rows reconcile.

### Timeout behaviour
Every Google call via Phase-2 `fetchWithTimeout` (~8s). The Portal write has
already committed, so a timeout is invisible to the user — the row stays
`pending`. Calendar views render from Portal rows + stored `meet_url` with **zero
network I/O**; the UI is never blocked on Google.

### Conflict resolution
One-way sync ⇒ **Portal always wins.** External Google edit → reconcile PATCHes
back to desired state (on `412` etag mismatch, re-fetch then overwrite; drift may
be logged, never imported). Deleted-in-Google + alive-in-Portal → recreated with
the same deterministic id. Concurrent Portal edits → transaction +
`sync_version` bump; reconciler always projects the latest committed row.

### Google Meet generation
Created inline with the meeting event (`conferenceData.createRequest`,
`hangoutsMeet`, `conferenceDataVersion=1`, deterministic `requestId`). The Meet
URL is read from the created event and **stored on the Portal row (`meet_url`)**
so it displays even when Google is down. Meetings only, per-meeting flag. Event
success + conference failure ⇒ event `synced`, Meet surfaced as separately
`pending` — never blocking.

### Task completion semantics (D3)
Completion is Portal-authoritative (Phase-1 audit trigger stamps
`completed_by/at`, immutable). A completed task's **projected calendar event is
removed**; the Portal retains the full historical record. Meetings are not
"completed" — they are historical entities handled independently.

### Edit semantics
Editing any syncable field bumps `sync_version`, recomputes `content_hash`,
marks `pending`. The reconciler **Updates the existing event by its
deterministic id** — edits never create a new event. Attendee changes are
diffed; toggling Meet adds/removes `conferenceData`. Editing a not-yet-projected
row just updates desired state before first Create.

### Deletion semantics
Portal soft-delete (`deleted_at`) is authoritative. **Cancel a meeting** →
Google event `status=cancelled` (attendees notified), then archive. **Delete** →
remove silently. Reconciler Delete treats `404/410` as already-gone success.
Hard-delete is never used (audit integrity).

### Recurring strategy (D4 — deferred)
Recurrence is **explicitly out of Phase 3**. Schema reserves `recurrence_rule` +
`series_id`. When implemented, the chosen model is **Portal-side materialisation**
(one concrete row per occurrence over a rolling horizon, each an ordinary
syncable item) — it fits the authoritative model and reuses all semantics above.
Google RRULE remains a possible later optimisation only.

### Time-zone handling
Storage: `timestamptz` (UTC instants) + IANA `time_zone` per row (default agency
zone). Projection: Google `start`/`end` as RFC3339 **with explicit `timeZone`**
so DST is handled by the zone, never a fixed offset; all-day items use `date`.
UI renders from the stored instant + zone. Server local time is never used.

### Event ownership
**Calendar ownership** = always the shared agency account (organizer of every
event; Meet hosted under it; attendees are guests). **Portal ownership** = the
Portal creator (Phase-1 `created_by`), driving Portal permissions/RLS
(admin-only). RSVP state stays in Google, non-authoritative.

---

## Future-proofing (designed for, not built in Phase 3)

- **Multi-calendar:** `google_calendar_id` is stored **per row** (defaulting to
  the configured shared calendar) and the engine targets a calendar id per
  operation. A future `calendars` registry maps Portal contexts → calendars; no
  reconciler change required.
- **Multi-account:** `calendar_credentials` (single row today) evolves to a
  multi-row table keyed by account; `getAccessToken(account)` gains a selector;
  the Phase-2 `account.ts` policy point becomes an allowlist. Token/refresh/crypto
  core unchanged.

## Approved project decisions

- **D1** — Introduce a dedicated `meetings` table. Do **not** overload `tasks`
  with attendees, Meet links, or scheduling metadata.
- **D2** — After-commit, best-effort projection + eventual reconciliation. The
  reconciler is idempotent and safe to replay at any time.
- **D3** — Completed tasks remove their projected calendar events; the Portal
  keeps the historical record. Meetings are independent historical entities.
- **D4** — Recurrence deferred to a later phase; design for it, do not implement.

## Scope boundary

**In Phase 3:** `meetings` entity + optional scheduled-task projection; the
four-operation projection engine (deterministic-id Create, etag-guarded Update,
Cancel/Delete, idempotent Reconcile); Meet generation; the sync-state model;
time-zone handling; single account + single calendar; structured sync
observability.

**Deferred (designed-for, not built):** recurrence, multi-calendar,
multi-account, inbound/RSVP read-back, durable job queue.

## Alignment

Upholds the Phase-2 invariant (writes commit before any Google call; views do no
network I/O; every call timed-out, transiently retried, failures land only in
`sync_state`). Follows `INTEGRATION_STANDARD.md` (reuses `src/lib/net`
timeout/retry/typed-errors/logging + correlation IDs; Phase-2 status lifecycle;
`src/lib/google` behind its `index.ts` facade; admin-only, `PLANNER_ENABLED`-
gated, RLS as Phase 1).
