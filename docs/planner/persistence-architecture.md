# Task Domain — Persistence & Data-Model Architecture
### Phase B2 · persistence architecture · source of truth

| | |
|---|---|
| **Status** | Approved |
| **Phase** | B2 |
| **Purpose** | Permanent persistence and data-model architecture for the Planner Tasks domain |
| **Scope** | Conceptual persistence boundaries, invariants, security and rollout; no SQL or implementation |
| **Implementation status** | Pre-implementation |
| **Last updated** | 2026-08-02 |

**Companion documents.** The [Execution Model](./execution-model.md) defines **product behaviour**. The [Task Domain Architecture](./task-domain-architecture.md) defines **domain behaviour and invariants**. This document defines **storage principles and security boundaries**. The [Schema & Migration Specification](./schema-and-migration-spec.md) defines the **exact implementation blueprint** built on these principles. Future migrations, repositories, services, APIs, automations, and UI must conform to **all four**.

Field names/types below are **conceptual data-model** language, not DDL. No SQL, migrations, code, repositories, services, APIs, or UI are designed here.

---

## 0. Audit of existing foundations

**Identity model.** `public.profiles` (`id` = `auth.users.id`, `role` ∈ user_role default `client`, `client_id`, `full_name`, `email`, `avatar_url`). `is_admin()` is a `SECURITY DEFINER STABLE` function returning `role='admin'`. There is **no team entity and no workspace/tenant column anywhere** — the multi-tenant concept in the Portal is *client-facing* (`client_id`), not an internal-team workspace. The approved workspace seam is **entirely greenfield**.

**Established conventions (to reuse):**
- **Audit trigger** (`meetings_enforce_audit`, `tasks_enforce_audit`): `SECURITY INVOKER`, stamps `created_by/created_at` from `auth.uid()` (non-spoofable), holds them immutable on UPDATE, and derives completion/cancellation metadata from status transitions.
- **Consistency CHECK constraints** (e.g. `meetings_cancel_consistency`, `tasks_completion_consistency`) tying a status to its metadata.
- **Partial indexes on live rows** (`where deleted_at is null`).
- **RLS**: `enable` + **`force`**, admin-only via `is_admin()`, **no DELETE policy → soft delete only**, `grant … to authenticated`, `revoke … from anon`.
- **Service-role-only tables** (`calendar_projections`, `calendar_credentials`): RLS forced with **no policies**, `revoke authenticated`, `grant service_role`; the UI only ever sees a whitelisted safe projection.
- **Atomic multi-row writes** via a `SECURITY INVOKER` PL/pgSQL function (`create_meeting_with_attendees`) — one transaction, all-or-nothing, RLS + trigger still apply.
- **Guarded `SECURITY DEFINER` RPC** (`soft_delete_meeting`) with internal `is_admin()` re-check for privileged transitions.
- **Idempotency** via a nullable column + partial-unique index (`meetings_idempotency_key_idx`).

**Deployment state (decisive fact).** Migrations are applied **manually and selectively** (SQL editor / `supabase db push`). Meetings migrations **0028–0034 are deployed to production; `0027_planner_tasks` is NOT** — production leap-frogged it. **There is no production tasks data.** This means 0027 can be superseded with zero data-preservation cost.

**`0027` vs the approved architecture.** 0027 encodes a *three-state* enum lifecycle (`todo/in_progress/completed`), a *three-value* priority enum (`normal/high/urgent`), a **NOT NULL `assignee_id`**, free-text `client_or_project`, and **no** owner, workspace, versioning, waiting/blocker model, dependencies, subtasks, labels, recurrence, reminders, event log, `due_date`, `started_at`, or `archived_at`. It contradicts the approved seven-state lifecycle, principal ownership, and event-first atomicity on nearly every axis. **Verdict: SUPERSEDE** (do not deploy, do not evolve in place); retire it and author a fresh task-domain migration set numbered after 0034. Keep 0027's *conventions*, discard its *schema*.

---

## 1. Aggregate persistence

The **Task aggregate root** = one `tasks` row (single-valued state) + satellites (blockers, dependencies, labels, reminders, events) keyed by `(workspace_id, task_id)`.

| Concern | Where | Type / nullability | Notes |
|---|---|---|---|
| Identity | `tasks.id` (+`workspace_id`) | uuid PK | composite-FK seam (§15) |
| Lifecycle state | `tasks.status` | text + CHECK, not null | 7 states (§2) |
| Title / description | `tasks.title` / `tasks.description` | text not null / text null | rename 0027 `notes` |
| Creator | `tasks.created_by` | uuid→profiles, not null, immutable | trigger-stamped |
| Owner | `tasks.owner_user_id` | uuid→profiles, null only in Inbox | **user owner only in v1**; no `owner_type` |
| Assignee | `tasks.assignee_id` | uuid→profiles, nullable | individual only |
| Priority | `tasks.priority` (+`critical_reason`) | text+CHECK, default `normal` | §3 |
| Effort | `tasks.estimated_minutes` | int null `>0` | reuse |
| Scheduled / Due | `tasks.scheduled_date` / `due_date` | **date**, null | §5 |
| Started/Completed/Archived | `started_at`/`completed_at`/`completed_by`/`archived_at` | timestamptz/uuid null | trigger-derived |
| Waiting summary | `tasks.blocked_since` + `resume_target` | timestamptz + text('planned'\|'scheduled') null | detail in `task_blockers` (§6) |
| Concurrency | `tasks.aggregate_version` | int not null | §14 — **concurrency only**, not event uniqueness |
| Lifecycle archival | `status='archived'` + `archived_at` | — | auditable/reportable |
| Physical erasure | `tasks.deleted_at` | timestamptz null | **reserved for exceptional admin erasure only — never set by Drop/Cancel** |
| Workspace | `tasks.workspace_id` | uuid not null | §15 |
| Parent / client / recurrence | `parent_id` / `client_id` / `recurrence_definition_id` + `occurrence_slot` | uuid / date-key null | §8, §10 |

**Archived vs deleted split:** `status='archived'` + `archived_at` is the **lifecycle** terminal state (retained, reportable). `deleted_at` is **physical erasure**, reserved for exceptional administrative removal (§17). They are distinct columns; conflating them would make "archived but visible in Reporting" impossible.

---

## 2. Status representation → constrained text + CHECK

`inbox · planned · scheduled · in_progress · waiting · completed · archived`. Rejected: **enum** (non-transactional `ADD VALUE`, no remove/reorder — the very reason 0027 must go) and **reference table** (needless joins). Chosen matches the meetings convention: evolvable, transaction-safe, self-documenting. Priority follows suit.

## 3. Priority representation

`priority` text+CHECK ∈ `critical·high·normal·low`, default `normal`; rank derived in code. `critical_reason` text with CHECK *(present iff priority=critical)*; cleared by the domain when priority leaves critical; the reason **history** lives in `TaskPriorityChanged` events.

---

## 4. Owner & Assignee → hybrid direct columns; user-only owner in v1

- **Rejected — `owner_id + owner_type('user'|'team')` now:** the DB cannot referentially validate a `team` owner (no teams table, no principal registry). A forward-declared `team` value would be an **unenforceable owner** — speculative flexibility over enforceable truth.
- **Rejected — participations-only for the hot roles:** breaks the flat hot path and the ownership invariants.
- **Chosen — `owner_user_id` (→ profiles), user owners only in v1.** The *domain concept* remains "Owner principal"; persistence constrains it to the only principal type the database can enforce today. `assignee_id` → profiles, nullable, individual.

**Rules:** owner mandatory beyond Inbox `CHECK (status='inbox' OR owner_user_id is not null)`; assignee required for In Progress `CHECK (status<>'in_progress' OR assignee_id is not null)`; owner/assignee separate columns, separate commands/events; workspace-membership of both enforced via the seam (§15).

**Future team ownership without rewriting history:** introduce a `principals` (or `task_participations`) model in a later migration, add `owner_principal_id`, **backfill existing `owner_user_id` values as user-principals**, then retire the column. **Task history is untouched** because events reference the *actor* by user id (§8/§12), not by the owner column; ownership changes are already captured as `TaskOwnerChanged` events. Purely additive forward migration.

---

## 5. Scheduling & temporal fields

`created_at` timestamptz not null, immutable · `scheduled_date`/`due_date` **date**, null (agency-local *day* concepts — `date` avoids TZ drift; a future intraday deadline is an additive `due_time`) · `started_at`/`completed_at`/`completed_by`/`archived_at` timestamptz/uuid null · `blocked_since` timestamptz null · `updated_at` timestamptz not null (trigger). "Today" = `(now() AT TIME ZONE 'Africa/Johannesburg')::date`, centralised in one helper. **Overdue** = `due_date < today(agencyTZ) AND status ∉ {completed,archived}` — derived in reads, never stored.

## 6. Waiting & blocker model → summary + detail

`task_blockers`: `id · workspace_id · task_id · blocker_class ∈ {person,client,approval,asset,dependency} · reference_id (principal or prerequisite task) · reason · created_at · resolved_at (null=active)`. Summary on `tasks`: `status='waiting'`, `blocked_since` (min active), `resume_target` (∈ planned/scheduled, **never in_progress**). Multiple simultaneous blockers = multiple active rows. Idempotent block via unique `(task_id, blocker_class, reference_id)` on active rows; unblock sets `resolved_at`. **Auto-unblock only when zero active blockers remain** (domain-driven), returning to `resume_target`.

## 7. Dependencies

`task_dependencies`: `id · workspace_id · dependent_id · prerequisite_id · kind ∈ {hard,info} · resolved_at · created_at`; composite FKs to `tasks(workspace_id,id)` (same-workspace structural); unique `(dependent_id,prerequisite_id,kind)`; CHECK `dependent_id<>prerequisite_id`. Acyclicity in the **domain** (DB trigger backstop for hard edges). Completing a prerequisite → reactor sets `resolved_at` + emits `DependencyResolved`; adding an unmet hard edge to an actionable dependent → writes a `dependency` blocker. Prerequisite Drop/Archive **resolves** its outgoing hard edges (no cascade delete; history preserved). Indexes: `(prerequisite_id) where resolved_at is null` (downstream), `(dependent_id) where resolved_at is null` (upstream).

## 8. Subtasks (one level)

`tasks.parent_id` self-ref, composite FK same-workspace; one-parent = one column; one-level enforced in domain + trigger (a child cannot be a parent); `CHECK parent_id<>id`; parent completion rejected while active children exist (domain + trigger backstop); no auto-complete of parents; index `(parent_id) where deleted_at is null`.

## 9. Labels

`labels`: `id·workspace_id·name·color_token·archived_at`, unique `(workspace_id,lower(name))`. `task_labels`: `(task_id,label_id,workspace_id)` unique `(task_id,label_id)`, composite FK same-workspace. Presentation boundary = a bounded `color_token` + name only. Labels are **archived**, never hard-deleted (history stays valid).

## 10. Recurring definitions & instances

`recurring_definitions`: `id·workspace_id·owner_user_id·template(title,description,priority,estimate,assignee policy,due-offset)·rule(simple interval+unit — NOT full RRULE)·mode ∈ {completion,schedule}·timezone·missed_policy ∈ {skip,roll}·active·next_occurrence`. Instances: `tasks.recurrence_definition_id` + `occurrence_slot`. Completion reactor (completion mode) or temporal evaluator (schedule mode) generates the next instance; **archiving never generates**. **Idempotency: a permanent unique `(recurrence_definition_id, occurrence_slot)`** — a durable business key, independent of generic command-receipt expiry. Instances reference the definition immutably; editing the definition affects only future generation. Full calendar recurrence deferred.

## 11. Reminders

`task_reminders`: `id·workspace_id·task_id·remind_at·state ∈ {pending,due,delivered,cancelled}·delivered_at·dedupe_key`. Temporal evaluator flips `pending→due`, emits `ReminderDue`; delivery is a separate service. **No provider payloads/coupling.** Idempotent via unique `(task_id,remind_at)` / `dedupe_key`.

---

## 12. Domain event log (ordered, immutable)

`task_events` (append-only): `event_id (uuid PK) · workspace_id · task_id · aggregate_version (int) · event_sequence (int) · event_type · event_schema_version (int) · actor_kind · actor_user_id · actor_ref · actor_display · occurred_at · correlation_id · causation_id · command_idempotency_key (null) · payload (jsonb, sanitized)`.

**Event ordering vs concurrency:**
- **One command → one new `aggregate_version`; that command emits 1..N events, each with an `event_sequence` starting at 1**, strictly ordered within the command.
- **Uniqueness: `(task_id, aggregate_version, event_sequence)`** — this is *event ordering*, not the concurrency gate.
- **A single-event command uses `event_sequence = 1`.**
- **Per-task ordering = `(aggregate_version, event_sequence)`.** No global ordering promised (an optional `global_seq` is convenience only).
- The atomic completion-from-Waiting persists `TaskUnblocked (v=k, seq=1)` then `TaskCompleted (v=k, seq=2)` — same version, ordered sequences, one transaction.

**Actor representation:** `actor_kind ∈ {user, automation, system}` + `actor_user_id` (nullable FK→profiles, `ON DELETE SET NULL`, set only when kind=user) + `actor_ref` (stable text id for automation/system principals) + `actor_display` (immutable denormalized snapshot). No polymorphic FK. Identity stays understandable after a user is deactivated/deleted because `actor_display` is a snapshot and does not depend on the profile row surviving.

**Immutability & privacy:** original `task_events` rows are **never updated or deleted** — no UPDATE/DELETE policy, `revoke` mutation, reject-mutation trigger. Payloads carry only sanitized domain facts (ids, before/after, reasons) — **never secrets or provider bodies**. Privacy is handled by a **redaction overlay, never by editing payloads** (§17). Retained long-term; partitioning deferred.

**Atomic state + events (the write invariant):** each command commits in **one transaction** that (1) checks `expected_version = tasks.aggregate_version`, (2) writes task/satellite state and **increments `aggregate_version` once**, (3) appends the ordered events at that version, (4) writes the command receipt. All-or-nothing. Concurrency is enforced on `tasks.aggregate_version` (§14); ordering is enforced by `(task_id, aggregate_version, event_sequence)`.

---

## 13. Command idempotency & receipt retention

`command_receipts`: `workspace_id · idempotency_key · command_type · payload_hash · outcome(task_id+resulting version) · created_at · expires_at`; unique `(workspace_id, idempotency_key)`. Replay with same key → returns stored outcome (no re-apply). **Same key, different `payload_hash` → rejected as conflict.** Service-role-only.

**Retention principle:** a receipt must live **at least as long as the maximum supported retry/replay window**; pruning must never let a *plausible delayed retry* re-apply a command; receipts are small and archivable; retention is **configurable and conservative**.
- **v1 recommendation: 30 days**, configurable — covers browser retries, background jobs, and automation retries, with head-room before any offline/mobile replay exists. (24–48h was too short for background/automation retries.)
- **Critical externally-triggered commands** may carry a **longer or command-type-specific retention**.
- **Durable business idempotency keys are separate and permanent** — notably **recurring generation `(definition_id, occurrence_slot)`** (§10) and any external-trigger natural key — enforced by their own unique constraints, never expiring with generic receipts.

## 14. Optimistic concurrency

`tasks.aggregate_version` (int) increments **once per command**. Commands pass `expected_version`; the atomic operation rejects mismatches with a typed `VersionConflict`. First-writer-wins completion: two `CompleteTask` at version N → first bumps to N+1 and emits events; second mismatches and, via §13 idempotency, resolves to "already completed" (no duplicate). Concurrency lives **solely** on `tasks.aggregate_version`; event uniqueness lives on `(task_id, aggregate_version, event_sequence)`.

---

## 15. Workspace boundary & membership

- Minimal `workspaces` table, **one seeded agency row**. Every task-domain table carries `workspace_id NOT NULL`. Intra-domain references use **composite FKs including `workspace_id`** (requires unique `(workspace_id,id)` on `tasks`) → cross-workspace references are **structurally impossible**.
- **`profiles.workspace_id` added**; **all admin profiles backfilled** to the seeded workspace. `current_workspace_id()` (SECURITY DEFINER) **fails closed** — returns null / denies when the profile has no workspace.
- **All task commands require a resolved workspace.**
- **`is_admin()` and workspace scoping are separate, ANDed RLS conditions** — a client/rep sharing a workspace **gains no task visibility**, because the admin gate still fails. (Client/rep profiles may be left null-workspace; they never reach tasks regardless.)
- **One workspace per profile suffices for v1.** Future multi-workspace membership migrates cleanly via a `profile_workspaces` (profile↔workspace) table, backfilling each profile's single `workspace_id` as its first membership, with `current_workspace_id()` resolving from an explicit active-context selection — no task rows change. Commercial tenancy (billing, cross-workspace admin) stays deferred.

---

## 16. Internal-only atomic persistence boundary

The generic atomic-apply persistence function is an **INTERNAL server boundary — not a browser-callable RPC.** Re-checking `is_admin()` inside it is **not** sufficient: an authenticated user who could invoke it would craft their own "already-validated" transition envelope and bypass the TypeScript state machine entirely.

**Execution privileges (locked):**
- Execute is **revoked from `anon` and `authenticated`**; the operation is **callable only by trusted server-side infrastructure** via the **service role** (or a dedicated, tightly-scoped internal database role).
- Task/satellite/event/receipt tables remain **read-only via RLS for admins and have no direct write policies**; the internal atomic operation is the sole writer.

**The one legal path (every actor, including automation/AI):**
```
Browser / automation / AI
  → authenticated server action or command endpoint   (1) session authentication
  → application authorization                          (2) role + workspace: is_admin() AND workspace
  → TypeScript domain command handler                  (3) load state + version, validate transition,
                                                            build the controlled command-result
  → INTERNAL-ONLY atomic persistence operation         (4) service-role connection; version check;
                                                            stamp audit/version/metadata server-side;
                                                            persist task + satellites + receipt + ordered
                                                            events atomically
```
Automation and AI **enter at step (2/3) through the same application command service** — they never hold, and never call, the persistence operation directly. There is no privileged shortcut around the state machine.

**Carrying the original actor identity across a service-role connection.** The persistence operation runs on a **service-role connection** (which bypasses RLS and would otherwise have no `auth.uid()`), so the **authenticated actor identity must be passed explicitly as a validated parameter**, not inferred from the connection:
- Steps (1)–(2) establish and authorize the real actor from the *session*, **before** the service-role connection is used.
- The domain handler includes that verified actor identity (and `actor_kind`) in the controlled command-result.
- The internal persistence operation **records the passed actor** into audit fields and events (`created_by`, `actor_user_id`, `actor_display`) — it trusts the actor value *only because the sole caller is trusted server code that already authenticated and authorized it*. Because the operation is not reachable by `authenticated`, no untrusted caller can spoof the actor parameter.
- This deliberately **replaces the `auth.uid()`-based stamping** used by the meetings audit trigger: meetings allowed direct authenticated writes (so `auth.uid()` was trustworthy); Tasks forbid direct writes, so the trusted actor travels as an explicit, server-supplied parameter.

**Approach A vs B:** **A — one strictly-bounded, internal-only atomic-apply operation** accepting an enumerated command-result envelope (command_type, resulting status, whitelisted settable columns, ordered events, expected version, idempotency key), keeping the single state machine in TypeScript. **B — command-specific RPCs** pushes per-command logic into PL/pgSQL, partially duplicating the state machine. **Recommendation: A.** DB constraints/triggers (CHECKs, composite FKs, event immutability, `(task_id, aggregate_version, event_sequence)` uniqueness, version gate) remain **defensive backstops**. A few **privileged internal operations** (administrative erasure, restore) may be separate internal functions — likewise never granted to `authenticated`. Signatures deferred to B3.

---

## 17. RLS & security (incl. archived vs deletion, privacy redaction overlay, event read access)

- **Task + satellite tables:** RLS `enable+force`; **read** policy `is_admin() AND workspace_id=current_workspace_id() AND deleted_at is null`. **No direct write policies** — writes only via the internal atomic operation (§16). **Clients/reps: zero access** (never referenced). A future client-facing task feature is a *new explicit policy*, never a default.
- **Archived vs physically deleted:** **`DropTask`/Cancel → `status='archived'` (cancelled reason); it does NOT set `deleted_at`.** Archived rows have `deleted_at is null`, so they **pass RLS and remain visible to admins and to Reporting**; active-surface lenses exclude them by **query-level status filters**, not by RLS. **`deleted_at` is reserved for exceptional administrative erasure / corruption cleanup / future privacy-retention**, performed only via a **separate privileged path with its own audit policy** — ordinary UI/domain commands never set it. Physically-erased rows are hidden from *everyone* by the `deleted_at is null` RLS clause.
- **Event immutability vs privacy (overlay, never edit):** original `task_events` rows are **never updated or deleted**. Privacy is handled by a **redaction overlay** — conceptual v1 mechanism (recommended): an **`event_redactions` overlay** that references a target event (or subject) and declares **which payload fields are suppressed/replaced**. The historical event is untouched; the overlay sits beside it. The **whitelisted safe event read model applies the overlay** and suppresses/masks the declared fields before returning anything; Reporting and safe views consume that **redacted projection**. **Every redaction is itself audited** (who/when/why). **Hard legal erasure**, if it ever arises, requires a **separately approved retention/erasure policy** and a distinct privileged path — never ordinary event mutation. The immutable event payload itself is never edited.
- **Event log access:** **service-role-only mutation** (no authenticated write; append via the internal operation/service role; reject-mutation trigger). **Admins read only through a whitelisted safe read model** — a curated projection exposing specific, schema-validated fields (type, occurred_at, `actor_display`, a human-readable summary, and a whitelisted subset of before/after values) — **never the raw `payload` JSON**. No client/rep/anon access. Payloads are sanitized and schema-versioned; no secrets or provider bodies. Being an admin never yields arbitrary event JSON.
- **Engine/plumbing** (`command_receipts`, recurrence scheduling state, reminder state machine): **service-role-only**. `anon` revoked everywhere; least privilege throughout.

## 18. Index strategy

| Query | Index |
|---|---|
| Today (mine, scheduled/overdue) | `(workspace_id, assignee_id, scheduled_date) where deleted_at is null and status in ('scheduled','in_progress','waiting')` |
| Overdue / due soon | `(workspace_id, due_date) where deleted_at is null and status not in ('completed','archived') and due_date is not null` |
| My Tasks | `(workspace_id, assignee_id, status) where deleted_at is null` |
| Inbox | `(workspace_id) where status='inbox' and deleted_at is null` |
| Team View (owner) | `(workspace_id, owner_user_id, status) where deleted_at is null` |
| Client refs | `(workspace_id, client_id) where client_id is not null` |
| Dependencies | `(prerequisite_id)/(dependent_id) where resolved_at is null` |
| Blockers | `(task_id) where resolved_at is null` |
| Recurrence gen | unique `(recurrence_definition_id, occurrence_slot)`; `(workspace_id) where active` |
| Temporal evaluator | reminders `(state, remind_at) where state='pending'`; recurrence `(next_occurrence) where mode='schedule' and active` |
| Event history (per task) | unique `(task_id, aggregate_version, event_sequence)` + `(workspace_id, task_id, aggregate_version, event_sequence)` for ordered reads |
| Subtasks | `(parent_id) where deleted_at is null` |

Reporting aggregate indexes deferred until real queries exist — no speculative indexing.

## 19. Migration 0027 gap analysis → SUPERSEDE

| 0027 | Class | Action |
|---|---|---|
| id, title, created_by/at, updated_at, estimated_minutes | Reusable unchanged | keep |
| notes | Reuse w/ mod | → `description` |
| completed_by/at, completion CHECK, deleted_at | Reuse w/ mod | extend states; add started/archived; **repurpose `deleted_at` to erasure-only** |
| audit trigger, partial indexes, admin-RLS | Reusable pattern | reuse; add workspace + write-lockdown |
| `assignee_id NOT NULL` | Unsafe | nullable; add `owner_user_id` |
| `client_or_project` free text | Obsolete | → `client_id` FK; project deferred |
| `status` enum, `priority` enum | Obsolete+unsafe | constrained text (7-state; critical/high/normal/low) |
| owner, workspace_id, aggregate_version/event_sequence, due_date, started_at, archived_at, resume_target, blockers, dependencies, parent_id, labels, recurrence, reminders, event log, command receipts | Missing | add per §1–§15 |

**Recommendation: SUPERSEDE.** Do not deploy 0027; do not evolve it in place. Author the task domain as new migrations **after 0034**.

## 20. Legacy 0027 supersession & convergence strategy

**"Do not deploy 0027" is insufficient** — clean environments, local test DBs, CI, and future migration runners apply files in numeric order and *will* run 0027 before the replacement. The strategy makes both worlds converge:

- **`0027_planner_tasks.sql` remains completely untouched — no comment, marker, or header added.** Its superseded status is recorded **only** in: (a) the Planner documentation, (b) the future B3 migration plan, and (c) the **superseding migration's own comments and preflight messaging**. Historical migration content is never altered.
- **Add a superseding migration after 0034**, defensive and idempotent, that conceptually:
  1. **Preflight — detect legacy 0027 objects** (legacy-shaped `public.tasks`: `status`/`priority` enums present, `assignee_id NOT NULL`, `workspace_id` absent).
  2. **Data-safety gate — if a legacy `tasks` table exists and contains any rows → ABORT with a clear preflight error** (raise, telling the operator to investigate). **Never silently drop data.**
  3. **If legacy objects exist and are empty → remove them** (legacy table + dependent trigger/function/policies/indexes; then **drop the legacy `task_status`/`task_priority` enums** so they cannot collide with the new constrained-text schema).
  4. **If legacy objects do not exist (production) → the drops are no-ops.**
  5. **Create the approved task-domain schema** (workspace seam → tasks → satellites → events/plumbing) in this later sequence.
- **Collision guarantees:** the new schema uses **constrained text, not enums** (dropped legacy enums leave no naming conflict); reused object names (`tasks`, `tasks_enforce_audit`) are drop-then-create in the superseding migration.
- **Convergence guarantee (and proof):**
  - **Clean/CI** = apply 0001…0034 (incl. an untouched 0027 that creates the empty legacy schema) → superseding migration drops legacy + builds new.
  - **Production** = apply only the superseding set (0027 never ran; drops are no-ops) → builds new.
  Both reach the **identical final schema**, verified by a **CI schema-parity test** (build DB "all migrations" vs "prod baseline + new set" and diff to zero).

## 21. Migration & rollout sequence (no SQL)

Workspace seam (+backfill admin profiles, `current_workspace_id()` fail-closed) → core `tasks` (7-state, `owner_user_id`, dates, version, triggers, **read-only RLS + write-lockdown**) → relationships (blockers, dependencies, `parent_id`) → labels → recurrence → reminders → event log + `command_receipts` + internal atomic-apply operation + immutability trigger + **safe event read model** + **redaction overlay** → regenerate `database.types.ts` → **RLS/atomicity/concurrency proof harness** (extend the meetings harness: admin-only, workspace scope, client/rep/anon denial, event immutability, atomic two-event Waiting completion, version conflict, recurrence idempotency) → unit tests for the pure state machine → **staging → production (manual, in order, after 0034)** → behind `PLANNER_ENABLED` **plus a `tasks` sub-flag** so no partially-enabled surface ships → rollback = flag-off (and, absent prod data, safe object-drop) → placeholder routes stay until the domain is complete and flagged on.

---

## Decisions Locked

1. **Status/priority representation** — constrained text + CHECK (not enums); status `inbox·planned·scheduled·in_progress·waiting·completed·archived`; priority `critical·high·normal·low` (default normal) with a CHECK-guarded `critical_reason`.
2. **v1 owner representation** — **`owner_user_id → profiles`, user owners only**; no persisted `owner_type='team'`. Concept stays "Owner principal"; team ownership is a later additive migration to a principal/participation model that backfills user-principals and **does not rewrite task history**.
3. **Scheduling** — `date` for `scheduled_date`/`due_date`; `timestamptz` for instants; overdue derived, agency-TZ.
4. **Waiting** — summary(task) + detail(`task_blockers`); auto-unblock only at zero active blockers; `resume_target` never `in_progress`.
5. **Dependencies & subtasks** — composite-FK same-workspace tables/columns; acyclicity + one-level in the domain with DB backstops.
6. **Event ordering within one aggregate version** — one command → one `aggregate_version`; each event gets an `event_sequence` starting at 1; **unique `(task_id, aggregate_version, event_sequence)`**; single-event commands use `event_sequence=1`; per-task order `(aggregate_version, event_sequence)`; no global order. **Concurrency enforced solely on `tasks.aggregate_version`.**
7. **Internal atomic persistence boundary** — the atomic-apply operation is **INTERNAL-ONLY**: `execute` revoked from `anon`/`authenticated`, callable only by trusted server infra via the service role / internal DB role. Sole write path: `browser|automation|AI → authenticated endpoint → app authz (is_admin() AND workspace) → TypeScript state machine → internal persistence op`. The verified **actor identity is passed explicitly** (not read from `auth.uid()` on the service-role connection) and recorded into audit fields/events; task tables stay read-only via RLS; DB constraints are backstops; `is_admin()` re-checks alone are **not** deemed sufficient to make a caller-supplied envelope safe.
8. **Idempotency receipt retention** — outlive the max retry/replay window and never allow a plausible delayed retry to re-apply. **v1 = 30 days, configurable**; longer/typed retention for critical externally-triggered commands; **durable business keys (recurring `(definition_id, occurrence_slot)`, external natural keys) are permanent and independent of receipt expiry**; same-key-different-payload is rejected.
9. **Workspace membership** — add `profiles.workspace_id`, backfill admins to the seeded workspace; `current_workspace_id()` **fails closed**; all task commands require a workspace; **`is_admin()` and workspace are separate ANDed conditions** (shared workspace never grants clients/reps task access); one workspace/profile suffices for v1; future multi-membership via an additive `profile_workspaces` table with no task-row changes.
10. **Archived vs deleted** — **Drop/Cancel → `status='archived'`, never sets `deleted_at`**; archived tasks stay auditable/reportable and pass RLS (lenses hide them by query, not RLS); **`deleted_at` = exceptional privileged erasure only**, separate audited path; physically-erased rows hidden from all by the RLS `deleted_at is null` clause.
11. **Immutable-event privacy strategy** — original `task_events` rows are **never updated or deleted**; privacy via an audited **`event_redactions` overlay** applied by the whitelisted safe read model; raw payloads unreachable to ordinary users; reports/safe views consume the redacted projection; hard legal erasure is a separate approved policy, never ordinary event mutation. The immutable event payload itself is never edited.
12. **Event actor representation** — `actor_kind ∈ {user,automation,system}` + `actor_user_id` (nullable FK→profiles, `ON DELETE SET NULL`) + `actor_ref` (automation/system) + **`actor_display` immutable snapshot**; no polymorphic FK; identity survives user deactivation via the snapshot.
13. **Event read security** — **service-role-only mutation**; admins read only a **whitelisted safe event read model** (never raw `payload` JSON); no client/rep/anon; payloads sanitized + schema-versioned; no secrets/provider bodies.
14. **Untouched 0027 supersession** — `0027_planner_tasks.sql` is **entirely unchanged** (no marker/comment/header). Superseded status documented only in Planner docs, the B3 plan, and the superseding migration's own comments/preflight. Clean/test may apply 0027 (empty legacy schema) which the superseding migration then safely removes; production (0027 skipped) converges to the identical final schema; unexpected legacy rows abort the migration; a CI schema-parity test proves convergence.
15. **Layered enforcement** — DB owns structural/relational truth and access; the atomic transaction owns state+event+version+receipt; the domain service (TypeScript) owns the lifecycle state machine and graph rules. **Business logic does not live in triggers.** Engine tables are service-role-only; task tables are admin+workspace read RLS with all writes funneled through the internal operation; clients/reps zero access.

---

## Final Consistency & Alignment Confirmation

Reviewed against [`execution-model.md`](./execution-model.md) and [`task-domain-architecture.md`](./task-domain-architecture.md).

| Check | Verdict |
|---|---|
| Every approved lifecycle transition is persistable | ✅ 7-state constrained text + the internal atomic-apply path express all commands, incl. `TriageAndScheduleTask` and Reopen/Restore. |
| Every illegal transition remains structurally guarded | ✅ Legality in the TS state machine; DB CHECKs (owner-required, assignee-for-InProgress, completion/critical consistency), composite FKs, immutability trigger, and **write-lockdown RLS** backstop it. |
| Multi-blocker Waiting is representable | ✅ `task_blockers` detail (many active rows across classes) + task summary; unblock only at zero active. |
| Atomic Waiting completion emits two ordered events | ✅ `TaskUnblocked (v=k,seq=1)` + `TaskCompleted (v=k,seq=2)` under `(task_id,aggregate_version,event_sequence)` in one transaction. |
| Recurrence generation is idempotent | ✅ Permanent unique `(recurrence_definition_id, occurrence_slot)`, independent of receipt TTL. |
| Parent completion rejected while children active | ✅ Domain rule + trigger backstop; no auto-complete. |
| Owner & assignee rules enforceable | ✅ CHECKs on owner-beyond-Inbox and assignee-for-InProgress; user-only owner is referentially valid. |
| Workspace references cannot cross boundaries | ✅ `workspace_id` everywhere + composite FKs make cross-workspace refs structurally impossible; `current_workspace_id()` fails closed. |
| No authenticated/browser caller can bypass the TS state machine | ✅ Persistence op internal-only (`execute` revoked from `authenticated`); task tables have no direct write policies. |
| All writes persist state, events and receipts atomically | ✅ One internal transaction: version check → task+satellites+receipt+ordered events. |
| Original event log strictly immutable | ✅ No UPDATE/DELETE; redaction never touches original rows. |
| Privacy-safe event reads can still redact | ✅ `event_redactions` overlay via the safe read model. |
| Current state and event history cannot diverge | ✅ Single atomic transaction writes state + version + ordered events + receipt; version-checked; append-only immutable log. |
| Production and clean environments converge | ✅ Defensive superseding migration (preflight, abort-on-data, no-op drops on prod) + CI schema-parity test. |
| Clients and reps retain zero Task access | ✅ RLS gates `is_admin() AND workspace`; no client/rep policy anywhere; internal-only writes. |
| No contradiction with the Execution Model or Task Domain Architecture | ✅ Confirmed — these mechanics tighten security/immutability/migration without altering any approved lifecycle, invariant, or principle. |

No contradictions remain. This document is the persistence-side source of truth for the Planner Tasks domain.
