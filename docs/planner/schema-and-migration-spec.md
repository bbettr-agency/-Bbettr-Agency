# Task Domain — Schema & Migration Specification
### Phase B3 · implementation blueprint · source of truth

| | |
|---|---|
| **Status** | Approved |
| **Phase** | B3 |
| **Purpose** | Permanent concrete schema and migration implementation blueprint for the Planner Tasks domain |
| **Scope** | Exact conceptual schema, migration sequence, constraints, security, verification and rollout; no SQL implementation |
| **Implementation status** | Pre-implementation |
| **Last updated** | 2026-08-02 |

**Companion documents.** The [Execution Model](./execution-model.md) defines **product behaviour**. The [Task Domain Architecture](./task-domain-architecture.md) defines **domain behaviour and invariants**. The [Persistence Architecture](./persistence-architecture.md) defines **storage principles and security boundaries**. This document defines the **exact implementation blueprint** — the schema, migration sequence, constraints, security, verification, and rollout an engineer implements without further architectural decisions. Future migrations, repositories, services, APIs, automations, and UI must conform to **all four**.

Column specs are **conceptual**, not DDL. No SQL, migrations, code, RPCs, repositories, services, APIs, automations, or UI are designed here.

**Audit baseline.** Latest applied migration is `0034_soft_delete_meeting.sql`; naming convention `NNNN_snake_case.sql`; production has `0028–0034` (meetings) but **not** `0027`; identity is `profiles` + `is_admin()` (SECURITY DEFINER STABLE); conventions are audit-trigger stamping, consistency CHECKs, partial-on-live indexes, `enable+force` RLS, service-role-only engine tables, atomic PL/pgSQL functions, guarded SECURITY DEFINER RPCs.

---

## 1. Migration Map (after 0034)

All migrations are **admin-only, additive, behind `PLANNER_ENABLED` + a new `TASKS_ENABLED` sub-flag**; all are **transactional** (Postgres DDL is transactional) unless noted; all are **idempotent / safe to rerun** via `if exists`/`if not exists` guards except the legacy preflight (0035), which is safe to rerun but *fails closed* on unexpected data. Rollback for the whole set (no prod data) = flag-off; destructive rollback = drop-new-objects.

| # | Filename | Purpose | Objects | Prereqs | Rerun-safe | Txn | Rollback / flag |
|---|---|---|---|---|---|---|---|
| 0035 | `planner_tasks_supersede_legacy` | Preflight + remove **empty** legacy 0027 objects; clears the ground and guarantees convergence (§2) | drops legacy `tasks`, enums `task_status`/`task_priority`, `tasks_enforce_audit` fn+trigger, legacy policies/indexes — **only if empty** | none | yes (no-op if absent; abort if data) | yes | n/a (no new objects) |
| 0036 | `planner_workspaces` | Workspace foundation (§3) | `workspaces` + seed row; `profiles.workspace_id` + backfill; `current_workspace_id()` | 0035 | yes | yes | drop col/fn; flag |
| 0037 | `planner_tasks_core` | New `public.tasks` (§4–§6) incl. `parent_id` self-FK | `tasks`, unique `(workspace_id,id)`, CHECKs, audit/version trigger, RLS (read-only), core indexes | 0036 | yes | yes | drop table; flag |
| 0038 | `planner_task_blockers` | Waiting detail (§7) | `task_blockers` + indexes + RLS | 0037 | yes | yes | drop table; flag |
| 0039 | `planner_task_dependencies` | Dependency edges (§8) | `task_dependencies` + composite FKs + indexes + RLS + backstop trigger | 0037 | yes | yes | drop table; flag |
| 0040 | `planner_labels` | Labels (§10) | `labels`, `task_labels` + indexes + RLS | 0037 | yes | yes | drop tables; flag |
| 0041 | `planner_recurring_definitions` | Recurrence (§11) | `recurring_definitions`; add FK `tasks.recurrence_definition_id` + unique `(recurrence_definition_id, occurrence_slot)` | 0037 | yes | yes | drop table/FK; flag |
| 0042 | `planner_task_reminders` | Reminders (§12) | `task_reminders` + indexes + RLS (service-role) | 0037 | yes | yes | drop table; flag |
| 0043 | `planner_task_events` | Event log (§13) | `task_events` + unique ordering + append-only trigger + service-role RLS | 0037 | yes | yes | drop table; flag |
| 0044 | `planner_event_redactions` | Redaction overlay (§14) | `event_redactions` + RLS (service-role) | 0043 | yes | yes | drop table; flag |
| 0045 | `planner_command_receipts` | Idempotency (§15) | `command_receipts` + unique + index (service-role) | 0037 | yes | yes | drop table; flag |
| 0046 | `planner_internal_persistence` | Internal atomic-apply op + privileged erasure/restore ops (§16) | functions; `revoke execute from anon, authenticated`; grant internal role | 0037–0045 | yes | yes | drop fns; flag |
| 0047 | `planner_safe_read_models` | Safe event read model + safe satellite views (§17) | read-only views/functions; admin+workspace grants | 0043–0044 | yes | yes | drop views; flag |

*(`parent_id`, `recurrence_definition_id`, `occurrence_slot`, `client_id` columns live in 0037; the recurrence FK/unique is added in 0041 — columns first, cross-table FK when its target exists.)*

---

## 2. Legacy 0027 Supersession Specification (migration 0035)

**`0027_planner_tasks.sql` is never modified.** 0035 carries all supersession commentary in its own header/preflight messages.

**Legacy identification (all must match to classify a table as "legacy 0027 tasks"):**
- `public.tasks` exists **and** columns include legacy markers: `status` typed as enum `public.task_status`, `priority` typed as enum `public.task_priority`, `assignee_id` **NOT NULL**, and **no** `workspace_id` / `owner_user_id` / `aggregate_version` columns.

**Detected legacy objects:** table `public.tasks`; enums `public.task_status`, `public.task_priority`; function+trigger `public.tasks_enforce_audit`; policies `tasks_select_admin/insert_admin/update_admin`; indexes `tasks_assignee_idx/scheduled_date_idx/status_idx/assignee_status_idx`.

**Data checks & abort conditions:**
- If legacy `tasks` **exists and `count(*) > 0`** → **ABORT** with `LegacyDataFound` (raise, message: "Legacy 0027 tasks contain N rows; investigate before superseding — no data destroyed"). Nothing is dropped.
- If legacy `tasks` **exists and is empty** → drop it and all dependent objects (trigger→function→policies→indexes→table→enums), in dependency order.
- If legacy objects **absent** (production) → every drop is a guarded no-op.

**Naming-collision avoidance:** the new schema uses **constrained text, not enums**, so dropping `task_status`/`task_priority` removes any type-name clash; reused names (`tasks`, `tasks_enforce_audit`) are dropped here and recreated cleanly in 0037. New satellite/enum-like names are all new (`task_blockers`, `task_dependencies`, …), no collision.

**Convergence proof (CI schema-parity test, §21):** build DB-A = apply `0001…0047` (incl. legacy 0027, which 0035 then removes); build DB-B = apply `prod baseline (through 0034, no 0027) + 0035…0047`; **diff the resulting schemas to zero** (tables, columns, constraints, indexes, functions, policies). Gate merges on parity.

---

## 3. Workspace Foundation (0036)

**`workspaces`**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `name` | text | no | — | CHECK non-empty |
| `slug` | text | no | — | unique |
| `created_at` | timestamptz | no | `now()` | immutable |

Seed exactly one row (the agency workspace) with a **fixed, well-known UUID constant** (referenced by backfill and future FKs).

**`profiles.workspace_id`** — add `uuid null` FK → `workspaces(id)`; **backfill all `role='admin'` profiles** to the seeded workspace; client/rep profiles left `null` (they never reach tasks). Index `(workspace_id)`.

**`current_workspace_id()`** — SECURITY DEFINER, STABLE, `set search_path=public`: returns `(select workspace_id from profiles where id = auth.uid())`. **Fail-closed:** returns `null` when the profile has no workspace, and every task RLS policy ANDs `workspace_id = current_workspace_id()` → a null result denies all rows.

**RLS expectation on `workspaces`:** `enable+force`; admins may `SELECT` their own workspace (`id = current_workspace_id()`); no client/rep access; writes service-role/seed only.

**Future multi-workspace seam:** a later additive `profile_workspaces(profile_id, workspace_id, is_default)` table; backfill each profile's single `workspace_id` as its default membership; `current_workspace_id()` then resolves from an explicit active-context selection. No task rows change.

---

## 4. Core `tasks` Table (0037)

Renames/splits vs 0027: `notes`→**`description`**; `client_or_project`→**`client_id`** FK (+ project deferred); **add** `owner_user_id`, `workspace_id`, `aggregate_version`, `due_date`, `started_at`, `archived_at`, `archive_reason`, `blocked_since`, `resume_target`, `parent_id`, `recurrence_definition_id`, `occurrence_slot`.

| Column | Type | Req | Default | Mutable | FK | Meaning / constraint / index |
|---|---|---|---|---|---|---|
| `id` | uuid | ✓ | `gen_random_uuid()` | immutable | PK | + unique `(workspace_id,id)` for composite FKs |
| `workspace_id` | uuid | ✓ | — | immutable | `workspaces(id)` | tenancy; every index leads with it |
| `title` | text | ✓ | — | mutable | — | CHECK `char_length(trim(title))>0` |
| `description` | text | — | null | mutable | — | — |
| `status` | text | ✓ | `'inbox'` | via op | — | CHECK ∈ 7 states; drives most indexes |
| `created_by` | uuid | ✓ | — | immutable/stamped | `profiles(id)` | creator |
| `owner_user_id` | uuid | — | null | mutable | `profiles(id)` | CHECK `status='inbox' OR owner_user_id is not null`; Team-View index |
| `assignee_id` | uuid | — | null | mutable | `profiles(id)` | CHECK `status<>'in_progress' OR assignee_id is not null`; Today/My-Tasks index |
| `priority` | text | ✓ | `'normal'` | mutable | — | CHECK ∈ {critical,high,normal,low} |
| `critical_reason` | text | — | null | mutable | — | CHECK `(priority='critical') = (critical_reason is not null)` |
| `estimated_minutes` | int | — | null | mutable | — | CHECK `>0` |
| `scheduled_date` | date | — | null | mutable | — | agency-local day; Today/Inbox index |
| `due_date` | date | — | null | mutable | — | deadline day; overdue/due-soon index |
| `started_at` | timestamptz | — | null | set-once | — | stamped on first `in_progress` |
| `completed_at` | timestamptz | — | null | stamped | — | completion metadata (see §5 status-aware rules) |
| `completed_by` | uuid | — | null | stamped | `profiles(id)` | completion metadata (see §5) |
| `archived_at` | timestamptz | — | null | stamped | — | required whenever `status='archived'` |
| `archive_reason` | text | — | null | stamped | — | CHECK ∈ {retention,cancelled} when archived; null otherwise |
| `blocked_since` | timestamptz | — | null | stamped | — | Waiting consistency CHECK |
| `resume_target` | text | — | null | stamped | — | CHECK ∈ {planned,scheduled}; Waiting consistency |
| `aggregate_version` | int | ✓ | `0` | op-incremented | — | optimistic concurrency; never from envelope |
| `parent_id` | uuid | — | null | mutable | composite→`tasks(workspace_id,id)` | CHECK `parent_id<>id`; subtask index |
| `client_id` | uuid | — | null | mutable | `clients(id)` | client-tasks index |
| `recurrence_definition_id` | uuid | — | null | mutable | (FK added 0041) | pairs with `occurrence_slot` |
| `occurrence_slot` | text | — | null | immutable-once | — | CHECK `(recurrence_definition_id is null)=(occurrence_slot is null)` |
| `created_at` | timestamptz | ✓ | `now()` | immutable | — | lead/backlog age |
| `updated_at` | timestamptz | ✓ | `now()` | stamped | — | last mutation |
| `deleted_at` | timestamptz | — | null | privileged only | — | **exceptional erasure only**; RLS `is null` gate |

**Completion/archive semantics (corrected — no stored `completed` boolean):** completion facts survive retention archival. `completed_at`/`completed_by` are set on completion and **retained** when a completed task ages into `archived` with `archive_reason='retention'`; they are **null** for `archived` with `archive_reason='cancelled'` and for all active states. `archived_at` is required whenever `status='archived'` (either reason). See §5 for the exact constraint set.

---

## 5. Task Constraint Catalogue (0037)

| Invariant | Exact rule | Layer | Why | Error mapping |
|---|---|---|---|---|
| Lifecycle values | `status ∈ {inbox,planned,scheduled,in_progress,waiting,completed,archived}` | **DB CHECK** | fixed vocabulary, structural | `IllegalTransition`/constraint |
| Priority values | `priority ∈ {critical,high,normal,low}` | **DB CHECK** | structural | constraint |
| Title non-empty | `char_length(trim(title))>0` | **DB CHECK** | structural | constraint |
| Positive effort | `estimated_minutes is null OR >0` | **DB CHECK** | structural | constraint |
| Owner beyond Inbox | `status='inbox' OR owner_user_id is not null` | **DB CHECK** | invariant holds regardless of code | `MissingOwner` |
| Assignee for In Progress | `status<>'in_progress' OR assignee_id is not null` | **DB CHECK** | invariant | `MissingAssignee` |
| Critical reason iff Critical | `(priority='critical') = (critical_reason is not null)` | **DB CHECK** | structural | constraint |
| **Completed metadata** | `status='completed'` ⇒ `completed_at not null AND completed_by not null AND archived_at is null AND archive_reason is null` | **DB CHECK** | metadata integrity | constraint |
| **Retention-archived preserves completion** | `status='archived' AND archive_reason='retention'` ⇒ `completed_at not null AND completed_by not null AND archived_at not null` | **DB CHECK** | reportable-as-completed | constraint |
| **Cancelled-archived is not completed** | `status='archived' AND archive_reason='cancelled'` ⇒ `archived_at not null AND completed_at is null AND completed_by is null` | **DB CHECK** | no false completion | constraint |
| **Archive requires reason+time** | `status='archived'` ⇒ `archived_at not null AND archive_reason in ('retention','cancelled')` | **DB CHECK** | metadata integrity | constraint |
| **Active states clean** | `status ∈ {inbox,planned,scheduled,in_progress,waiting}` ⇒ `completed_at is null AND completed_by is null AND archived_at is null AND archive_reason is null` | **DB CHECK** | metadata integrity | constraint |
| Waiting consistency | `(status='waiting') = (blocked_since is not null AND resume_target is not null)` | **DB CHECK** | metadata integrity | constraint |
| Resume target values | `resume_target is null OR ∈ {planned,scheduled}` | **DB CHECK** | structural | constraint |
| Parent ≠ self | `parent_id is null OR parent_id<>id` | **DB CHECK** | trivial cycle guard | `DependencyCycle` |
| Occurrence-slot pairing | `(recurrence_definition_id is null)=(occurrence_slot is null)` | **DB CHECK** | integrity | constraint |
| Deleted vs archived | Drop/Cancel sets `status='archived'`+reason, **never** `deleted_at`; `deleted_at` only via privileged op | **Persistence op + RLS** | policy, not a single-row CHECK | domain |
| Workspace-FK consistency | all intra-domain refs via composite FK incl. `workspace_id` | **DB composite FK** | structural impossibility | `CrossWorkspaceReference` |
| Transition legality | which status→status moves are legal (§ execution model) | **Domain state machine (TS)** | not duplicated in triggers | `IllegalTransition` |
| Dependency/subtask acyclicity, parent-completion-block | graph rules | **Domain + DB backstop trigger** | graph logic in app; trigger defends | `DependencyCycle`/`ActiveChildren` |

*(The five completion/archive rows are implemented as one consolidated CHECK over `(status, completed_at, completed_by, archived_at, archive_reason)` so the cases are mutually exhaustive.)*

---

## 6. Audit & Protected-Field Strategy (0037)

**Two mechanisms, cleanly separated:** a lightweight **DB trigger** for mechanical stamping that must hold under *any* writer, and the **internal persistence operation** for everything derived from a validated transition. **No lifecycle logic in triggers.**

| Field | Owner | Behaviour |
|---|---|---|
| `created_at` | DB default / trigger | stamped once; immutable |
| `created_by` | **persistence op** (from trusted actor) | set on insert; immutable |
| `updated_at` | DB trigger | `now()` on every write |
| `aggregate_version` | **persistence op** | increments exactly once per command; **never from envelope** |
| `started_at` | **persistence op** | stamped `now()` on first `in_progress`; set-once (immutable after) |
| `completed_at` / `completed_by` | **persistence op** | stamped on completion; **retained** through retention archival; cleared on reopen/restore |
| `archived_at` / `archive_reason` | **persistence op** | stamped on archive (retention preserves completion; cancelled forces it null) |
| `blocked_since` / `resume_target` | **persistence op** | stamped on Block; cleared on Unblock |
| `deleted_at` | **privileged erasure op only** | never set by ordinary commands or triggers |

**Timestamps are stamped by the op using its own `now()`** (not trusted from the envelope, preventing clock spoofing). The envelope conveys *which* transition and the resulting logical field values; the op derives all timestamps and the version. **Never accepted from the browser (which never writes) or the command envelope:** `aggregate_version`, `created_at`, `updated_at`, all audit timestamps, `deleted_at`, and event ordering fields.

**Retention archival transition** (`completed → archived/retention`): the op sets `archived_at`+`archive_reason='retention'` and **leaves `completed_at`/`completed_by` untouched**. **Cancel transition** (active → `archived/cancelled`): sets `archived_at`+`archive_reason='cancelled'` and asserts completion fields null. **Restore** (`archived → planned`): clears `completed_at`, `completed_by`, `archived_at`, `archive_reason`, and execution state; **historical events are never touched**.

---

## 7. `task_blockers` (0038)

| Column | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | PK |
| `workspace_id` | uuid | ✓ | composite FK with `task_id` → `tasks(workspace_id,id)` |
| `task_id` | uuid | ✓ | the blocked task |
| `blocker_class` | text | ✓ | CHECK ∈ {person,client,approval,asset,dependency} |
| `blocker_key` | text | ✓ | **immutable** stable identity, e.g. `person:<uuid>`, `client:<uuid>`, `dependency:<uuid>`, `approval:homepage-copy`, `asset:company-logo`; CHECK non-empty |
| `reference_user_id` | uuid | — | FK `profiles(id)`; set only when class=person |
| `reference_task_id` | uuid | — | composite FK `tasks(workspace_id,id)`; set only when class=dependency |
| `reference_client_id` | uuid | — | FK `clients(id)`; set only when class=client |
| `reason` | text | — | free text (approval/asset detail) |
| `created_at` | timestamptz | ✓ | this blocker's "since" |
| `resolved_at` | timestamptz | — | null = active |

**No polymorphic FK:** typed nullable reference columns each with a real FK, plus a CHECK that exactly the column matching `blocker_class` is populated (person→user, dependency→task, client→client; approval/asset→none but require a meaningful `blocker_key`). For FK-backed classes, `blocker_key` encodes the same reference (documented format). `blocker_key` is **immutable** for the record.

- **Multiple simultaneous blockers:** many active rows per task across classes, and **multiple distinct approval/asset blockers** via distinct `blocker_key`s.
- **Idempotency/uniqueness:** partial unique **`(task_id, blocker_class, blocker_key) where resolved_at is null`** — duplicate retries of the same key are no-ops; distinct keys coexist.
- **`blocked_since`** = min(`created_at`) of active rows, denormalised onto `tasks` by the op.
- **Same-workspace:** composite FKs.
- **Indexes:** `(task_id) where resolved_at is null`; `(reference_task_id) where resolved_at is null and blocker_class='dependency'`.
- **Retention:** resolved rows retained (history); never hard-deleted.
- **RLS:** admin+workspace read; writes via internal op only.

---

## 8. `task_dependencies` (0039)

| Column | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | PK |
| `workspace_id` | uuid | ✓ | — |
| `dependent_id` | uuid | ✓ | composite FK `tasks(workspace_id,id)` |
| `prerequisite_id` | uuid | ✓ | composite FK `tasks(workspace_id,id)` |
| `kind` | text | ✓ | CHECK ∈ {hard,info} |
| `resolved_at` | timestamptz | — | null = unmet; set when prerequisite completes/archives |
| `removed_at` | timestamptz | — | null = not manually removed |
| `removal_reason` | text | — | optional |
| `created_at` | timestamptz | ✓ | — |

**Lifecycle:** *active/unmet* = `resolved_at is null AND removed_at is null`; *resolved* = prerequisite completed/archived (`resolved_at` set); *removed* = manual (`removed_at` set); *historical* = any non-active row (retained, never overwritten).

- **Same-workspace:** both endpoints via composite FK.
- **Uniqueness (active-only):** partial unique **`(dependent_id, prerequisite_id, kind) where resolved_at is null and removed_at is null`** — a previously resolved/removed relationship may be **re-added as a new-identity edge**; no history overwritten.
- **Self-dependency:** CHECK `dependent_id<>prerequisite_id`.
- **Traversal indexes:** `(prerequisite_id) where resolved_at is null and removed_at is null` (downstream); `(dependent_id) where resolved_at is null and removed_at is null` (upstream).
- **Blocker coupling:** only **active hard** edges create `dependency` blockers; resolving *or* removing an edge **idempotently clears its blocker** when no equivalent active hard edge remains (Waiting clears only when all blocker classes clear).
- **Cycle detection:** **domain-owned** (walk on `AddDependency`); a **defensive DB trigger** rejects a hard edge that would close a cycle (`DependencyCycle`).
- **RLS:** admin+workspace read; writes via op only.

---

## 9. Subtasks (column in 0037; guard in 0037)

- **Parent FK:** `tasks.parent_id` composite FK `tasks(workspace_id,id)` (same-workspace structural).
- **One-level rule:** a task with non-null `parent_id` may not be a parent — enforced by domain + **defensive trigger** (reject making a task a parent when it has a parent, or giving a parent-having task a child).
- **Cycle prevention:** one-level + `CHECK parent_id<>id` makes deeper cycles impossible.
- **Parent-completion guard:** completion rejected while any active (non-completed/archived) child exists — domain + **trigger backstop** (`ActiveChildren`).
- **Deletion/archive:** archiving a parent does not archive children (independent lifecycles); no auto-complete.
- **Index:** `(parent_id) where deleted_at is null`.
- **Defensive trigger justified?** Yes — the one-level and parent-completion rules are graph invariants a buggy caller could violate; the trigger is a cheap backstop, not the primary logic.

---

## 10. Labels (0040)

**`labels`:** `id uuid PK · workspace_id uuid ✓ · name text ✓ · color_token text ✓ (CHECK ∈ bounded palette) · archived_at timestamptz null · created_at timestamptz ✓`. Unique `(workspace_id, lower(name))` (case-insensitive). **Archive, never hard-delete.** Unique `(workspace_id,id)` for composite FK.

**`task_labels`:** `task_id uuid · label_id uuid · workspace_id uuid` — unique `(task_id,label_id)`; composite FK to `tasks(workspace_id,id)` and to `labels(workspace_id,id)`, so associations cannot cross workspaces. Index `(label_id)` for "tasks with label".

**Historical associations:** archiving a label keeps existing `task_labels` valid (label resolvable); archived labels drop out of pickers. **RLS:** admin+workspace read; writes via op only.

---

## 11. Recurring Definitions (0041)

**`recurring_definitions`:**

| Column | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | PK; unique `(workspace_id,id)` |
| `workspace_id` | uuid | ✓ | — |
| `owner_user_id` | uuid | ✓ | FK `profiles(id)` — default owner of instances |
| `default_assignee_id` | uuid | — | FK `profiles(id)` — assignee policy default |
| `template_title` | text | ✓ | instance title |
| `template_description` | text | — | — |
| `template_priority` | text | ✓ | CHECK ∈ 4 values |
| `template_estimated_minutes` | int | — | CHECK `>0` |
| `template_client_id` | uuid | — | FK `clients(id)` |
| `rule_interval` | int | ✓ | CHECK `>0` — **simple v1 rule** |
| `rule_unit` | text | ✓ | CHECK ∈ {day,week,month} — **no full RRULE** |
| `mode` | text | ✓ | CHECK ∈ {completion,schedule} |
| `timezone` | text | ✓ | default `'Africa/Johannesburg'` |
| `missed_policy` | text | ✓ | CHECK ∈ {skip,roll} |
| `due_offset_days` | int | — | due = scheduled + offset |
| `next_occurrence` | date | — | schedule-mode evaluator cursor |
| `active` | boolean | ✓ | default true |
| `archived_at` | timestamptz | — | — |
| `created_at`/`updated_at` | timestamptz | ✓ | — |

- **Occurrence slot:** `text` in a **canonical format** (e.g. `YYYY-MM-DD` for date-based, or a monotonic sequence token) — the stable identity of one generated occurrence.
- **Permanent generation idempotency:** unique `(recurrence_definition_id, occurrence_slot)` on `tasks` — a **durable business key**, independent of `command_receipts` TTL. Regeneration with the same slot is a no-op.
- **Mode:** completion-mode generates on `TaskCompleted`; schedule-mode generated by the temporal evaluator at `next_occurrence`; **archiving never generates**.
- **Editing a definition** affects only *future* generation; existing instances are immutable relative to the definition.
- **Evaluator indexes:** `(next_occurrence) where mode='schedule' and active`; `(workspace_id) where active`.
- **RLS:** admin+workspace read; writes via op; evaluator (service-role) advances `next_occurrence`.

---

## 12. `task_reminders` (0042)

| Column | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | PK |
| `workspace_id` | uuid | ✓ | composite FK with task |
| `task_id` | uuid | ✓ | — |
| `remind_at` | timestamptz | ✓ | when to fire |
| `state` | text | ✓ | CHECK ∈ {pending,due,delivered,cancelled}; default `pending` |
| `dedupe_key` | text | — | provider-neutral idempotency |
| `claimed_at` | timestamptz | — | evaluator single-flight lock |
| `claim_token` | uuid | — | worker owns its claim |
| `delivered_at` | timestamptz | — | — |
| `attempts` | int | ✓ | default 0 — retry bookkeeping |
| `last_error` | text | — | **sanitized code only** |
| `created_at` | timestamptz | ✓ | — |

- **Lifecycle:** pending→due (evaluator)→delivered (delivery service) / cancelled.
- **Evaluator claim/locking:** `claimed_at`+`claim_token` (the `calendar_projections` single-flight pattern) so two workers don't double-fire.
- **Provider-neutral:** no provider payloads; `ReminderDue` event drives an external delivery service.
- **Idempotency:** unique `(task_id, remind_at)` and/or `dedupe_key`.
- **Indexes:** `(state, remind_at) where state='pending'`.
- **RLS:** **service-role-only** engine table (admins see reminder *intent* via a safe read if needed).

---

## 13. `task_events` (0043)

| Column | Type | Req | Notes |
|---|---|---|---|
| `event_id` | uuid | ✓ | PK |
| `workspace_id` | uuid | ✓ | carried on every event |
| `task_id` | uuid | ✓ | aggregate id |
| `aggregate_version` | int | ✓ | version *after* this command |
| `event_sequence` | int | ✓ | 1..N within the command |
| `event_type` | text | ✓ | CHECK ∈ known event names |
| `event_schema_version` | int | ✓ | per-type payload version |
| `actor_kind` | text | ✓ | CHECK ∈ {user,automation,system} |
| `actor_user_id` | uuid | — | FK `profiles(id)` `ON DELETE SET NULL`; set iff kind=user |
| `actor_ref` | text | — | stable id for automation/system |
| `actor_display` | text | ✓ | immutable snapshot (survives deactivation) |
| `occurred_at` | timestamptz | ✓ | op `now()` |
| `correlation_id` | uuid | — | request/chain grouping |
| `causation_id` | uuid | — | causing event/command |
| `command_idempotency_key` | text | — | links to `command_receipts` |
| `payload` | jsonb | ✓ | **sanitized** domain facts only |

- **Uniqueness / ordering:** unique `(task_id, aggregate_version, event_sequence)`; per-task order `(aggregate_version, event_sequence)`; **no global order** (optional `global_seq bigserial` convenience only).
- **Append-only enforcement:** no UPDATE/DELETE policy; `revoke` mutation; a **reject-mutation trigger** that rejects **every content-altering UPDATE and every DELETE**, for every role. The **sole** permitted mutation is PostgreSQL's referential cleanup — the FK-driven `actor_user_id` transition from a non-null user id to `NULL` when the referenced profile is deleted — allowed **only** when every other event field is unchanged (changing `actor_user_id` to another value, or nulling it while altering any other field, is rejected). This is referential cleanup, not an editable event mutation; the `actor_display` snapshot and all other content remain immutable.
- **Mutation access:** **service-role-only** (writes only via the internal op / service role).
- **Raw access restriction:** admins **never** read the table directly — only via the safe read model (§17).
- **Payload validation:** each `(event_type, event_schema_version)` has a **documented payload contract**; the op validates before append; consumers validate on read.
- **Schema evolution:** additive — new `event_schema_version` per type; old events remain valid; readers branch on version.
- **Retention:** long-term; partitioning by workspace/time deferred.

---

## 14. Event Redaction Overlay (0044)

**`event_redactions`** — the overlay; **original events are never touched.**

| Column | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | PK |
| `workspace_id` | uuid | ✓ | — |
| `target_event_id` | uuid | — | FK `task_events(event_id)`; per-event redaction |
| `subject_kind` / `subject_ref` | text | — | optional subject-level redaction (e.g. a person) |
| `redacted_fields` | text[] | ✓ | which payload paths to suppress/replace |
| `mode` | text | ✓ | CHECK ∈ {suppress,replace} |
| `replacement` | text | — | masked value when mode=replace |
| `reason` | text | ✓ | why |
| `redacted_by` | uuid | ✓ | actor (FK profiles) |
| `created_at` | timestamptz | ✓ | when |

- **Application:** the safe read model (§17) **joins the overlay** and suppresses/masks the declared fields before returning anything. Raw immutable events remain byte-identical.
- **Audit:** each redaction emits its own audit event (`EventRedacted`) — redaction is a logged action.
- **Boundary:** **legal hard-erasure is explicitly out of scope** — it requires a separately approved retention/erasure policy and a distinct privileged path; documented here only as a boundary, not designed.
- **RLS:** service-role write; overlay is consumed only through the safe read model.

---

## 15. `command_receipts` (0045) — success-only

Receipts persist **only outcomes that commit** — a receipt exists **iff** its command committed, consistent with all-or-nothing rollback.

| Column | Type | Req | Notes |
|---|---|---|---|
| `workspace_id` | uuid | ✓ | scope |
| `idempotency_key` | text | ✓ | unique `(workspace_id, idempotency_key)` |
| `command_type` | text | ✓ | — |
| `payload_hash` | text | ✓ | detects same-key/different-payload |
| `actor_kind`/`actor_user_id`/`actor_ref` | — | actor context |
| `result_task_id` | uuid | — | outcome identity |
| `result_aggregate_version` | int | — | resulting version |
| `outcome` | text | ✓ | CHECK ∈ {applied, replayed, accepted_noop} |
| `created_at` | timestamptz | ✓ | — |
| `expires_at` | timestamptz | ✓ | `created_at + retention` |

- **Outcomes:** `applied` (committed change), `accepted_noop` (semantically idempotent no-op that committed), `replayed` (existing receipt returned — no new row inserted). The `error` outcome and `error_code` column are **removed**.
- **Errors are never persisted here:** validation errors occur before persistence; `VersionConflict`/`IdempotencyConflict` are **returned but not inserted**; unexpected DB errors **roll back everything and leave no receipt**, so the **same key is retryable** after a transient failure.
- **Conflict detection:** same-key/different-`payload_hash` is rejected (`IdempotencyConflict`) **when an existing successful receipt is found**.
- **Operational error logging** belongs in sanitized application/observability logs, not the receipt.
- **Retention:** **30 days, configurable**; critical externally-triggered commands may set longer/typed retention.
- **Cleanup:** periodic TTL sweep (service-role) on `expires_at`.
- **Permanent business keys outside this table:** recurrence `(recurrence_definition_id, occurrence_slot)` and any external natural key — **never expire**.
- **RLS:** service-role-only.

---

## 16. Internal Atomic Persistence Operation — Contract (0046)

**Envelope (TS command handler → internal op):**

| Field | Source | Trust |
|---|---|---|
| `actor` `{actor_kind, actor_user_id?, actor_ref?, actor_display}` | session (steps 1–2) | trusted; recorded |
| `workspace_id` | authorized context | trusted |
| `command_type` | handler | enumerated |
| `task_id` | handler (null → op generates on create) | — |
| `expected_aggregate_version` | handler (null on create) | version gate |
| `command_idempotency_key` | handler | receipt key |
| `payload_hash` | handler | conflict detection |
| `task_field_deltas` | handler | **whitelisted** columns only (status,title,description,owner_user_id,assignee_id,priority,critical_reason,estimated_minutes,scheduled_date,due_date,resume_target,parent_id,client_id,recurrence_definition_id,occurrence_slot) |
| `satellite_changes` | handler | bounded ops: blocker add/resolve, dependency add/resolve/remove, label add/remove, reminder add/cancel |
| `ordered_events` | handler | `[{event_type, event_schema_version, payload}]` in sequence order |
| `expected_result` | handler | for the receipt |

**Never accepted (stamped internally):** `aggregate_version` value, `created_at`, `created_by` literal (taken from `actor`), `updated_at`, `started_at`/`completed_at`/`completed_by`/`archived_at`/`archive_reason`/`blocked_since` **timestamps** (derived from `command_type` + op `now()`), `deleted_at`, `event_id`, `occurred_at`, `event_sequence` (op assigns 1..N).

**Structural command/event integrity contract.** TypeScript remains the **sole lifecycle state machine**. The op maintains a **small structural contract keyed by `command_type`** — a *defensive consistency check, not a second legality engine*. Per command it validates: allowed `command_type`; required **resulting status category** (a specific status, or "unchanged" for attribute-only commands); required **event-type sequence**; **min/max event count**; **payload schema versions**; ordering. Unknown command types or mismatched sequences → `EventContractViolation`.

**Event-integrity catalogue (representative):**

| command_type | Resulting status | Required events (ordered) | Count |
|---|---|---|---|
| `CaptureTask` | inbox | `TaskCaptured` | 1 |
| `TriageTask` | planned | `TaskTriaged` | 1 |
| `TriageAndScheduleTask` | scheduled | `TaskTriaged`, `TaskScheduled` | 2 (ordered) |
| `StartTask` | in_progress | `TaskStarted` | 1 |
| `BlockTask` | waiting | `TaskBlocked` | 1 |
| `UnblockTask` | planned\|scheduled | `TaskUnblocked` | 1 |
| `CompleteTask` (actionable) | completed | `TaskCompleted` | 1 |
| `CompleteTask` (from waiting) | completed | `TaskUnblocked`, `TaskCompleted` | **2, in this order** |
| `ArchiveTask` (retention) | archived | `TaskArchived` | 1 |
| `DropTask` | archived | `TaskDropped` | 1 |
| `ReopenTask` | resume target | `TaskReopened` | 1 |
| `RestoreTask` | planned | `TaskRestored` | 1 |

**Attribute-only commands** assert *status category = "unchanged"* + exactly one event: `RenameTask`→`TaskRenamed`; `ChangePriority`→`TaskPriorityChanged` (+ `critical_reason` present when target=critical); `EditDescription`→`TaskDescriptionEdited`; `ChangeDueDate`→`TaskDueDateChanged`; `Reschedule`→`TaskRescheduled`; `Assign`/`Unassign`→`TaskAssigned`/`TaskUnassigned`; `ChangeOwner`→`TaskOwnerChanged`; `AddLabel`/`RemoveLabel`→`TaskLabeled`/`TaskUnlabeled`; `AddDependency`/`RemoveDependency`→`DependencyAdded`/`DependencyRemoved`. Multi-effect commands declare the **ordered pair** (e.g. `AddDependency` that auto-blocks → `DependencyAdded`, `TaskBlocked`).

The contract enforces: no status change without its required event; no zero-event mutation; no unrelated/duplicate event; no `TaskCompleted` without resulting `completed`; correct `TaskUnblocked`→`TaskCompleted` ordering. It does **not** decide *which* transition is legal (that stays in TS).

**Execution (single transaction):**
1. **Check receipt** — look up `(workspace_id, idempotency_key)`; if present and `payload_hash` matches → return stored outcome as `replayed` (no new row, no re-apply).
2. **Reject same-key/different-payload** → `IdempotencyConflict` (returned, not inserted).
3. **Verify version** — assert `expected_aggregate_version = tasks.aggregate_version` (skip on create) → else `VersionConflict` (returned, not inserted).
4. **Validate the structural event contract** for `command_type` → else `EventContractViolation`.
5. **Update task + satellites** — apply whitelisted deltas + bounded satellite changes; recompute `blocked_since` from active blockers.
6. **Increment `aggregate_version` once.**
7. **Append ordered events** at that version with `event_sequence` 1..N, stamping actor/`occurred_at`.
8. **Write a success receipt** (`applied` or `accepted_noop`).
9. **Commit atomically** — all-or-nothing; failures at any step abort the transaction leaving neither state/events nor a receipt. DB CHECKs/composite-FKs/immutability triggers are the final backstop.

**Access:** `revoke execute from anon, authenticated`; callable **only** by the service role / dedicated internal DB role. Task/satellite/event/receipt tables have **no direct write policies**. Automation/AI reach it only through the same application command service.

---

## 17. Safe Event Read Model (0047)

An **admin-only, workspace-scoped SECURITY DEFINER function** — the *only* event surface for humans. It **authorizes explicitly and fails closed**; it does **not** rely on base-table RLS being applied under SECURITY DEFINER.

**In-function checks, in order:**
1. **Require an authenticated actor** (`auth.uid()` not null) — else deny.
2. **`is_admin()`** — else deny.
3. **Resolve `current_workspace_id()`** — if null (fail-closed), deny.
4. **Workspace match** — only events whose `workspace_id = current_workspace_id()`.
5. **Keyset-pagination bounds** — `(aggregate_version, event_sequence)` cursor + max page size.
6. **Apply the redaction overlay** and return only whitelisted fields.

**Exposed columns:** `event_id, occurred_at, event_type, aggregate_version, event_sequence, actor_display, summary` (server-generated human-readable line), and a **whitelisted** subset of before/after values per event type. **Never exposed:** raw `payload` JSON, internal correlation/causation (unless whitelisted), secrets/provider bodies, unredacted subject data.

**Execute revoked from `anon`; granted only to `authenticated`**; the function denies non-admins and missing-workspace contexts. **Raw `task_events` and `event_redactions` remain inaccessible** to `anon`/`authenticated` (service-role-only), so the function is the sole human surface. Ordering by `(aggregate_version, event_sequence)` per task; keyset pagination.

---

## 18. RLS Matrix

Legend: **A+W** = admin AND workspace; **SR** = service-role only; **✗** = denied.

| Table | SELECT | INSERT | UPDATE | DELETE | RLS forced | Browser writes | Notes |
|---|---|---|---|---|---|---|---|
| `workspaces` | A+W (own) | SR/seed | SR | ✗ | yes | forbidden | — |
| `tasks` | A+W & `deleted_at is null` | ✗ (op only) | ✗ (op only) | ✗ | yes | forbidden | read-only RLS; writes via internal op |
| `task_blockers` | A+W | ✗ | ✗ | ✗ | yes | forbidden | op only |
| `task_dependencies` | A+W | ✗ | ✗ | ✗ | yes | forbidden | op only |
| `labels` | A+W | ✗ | ✗ | ✗ | yes | forbidden | op only |
| `task_labels` | A+W | ✗ | ✗ | ✗ | yes | forbidden | op only |
| `recurring_definitions` | A+W | ✗ | ✗ | ✗ | yes | forbidden | op/evaluator |
| `task_reminders` | SR (admin via safe read) | SR | SR | ✗ | yes | forbidden | engine |
| `task_events` | ✗ (safe read only) | SR | ✗ | ✗ | yes | forbidden | append-only; safe read model |
| `event_redactions` | ✗ (safe read only) | SR | ✗ | ✗ | yes | forbidden | overlay |
| `command_receipts` | SR | SR | SR | SR (TTL) | yes | forbidden | engine |
| safe read views/functions | A+W | — | — | — | in-function authz | — | admins read here |

**Three separated conditions everywhere:** workspace membership (`workspace_id = current_workspace_id()`), admin authorization (`is_admin()`), service-role engine access — **ANDed**, never conflated. **Clients and reps have zero task access** at every table.

---

## 19. Index / Query Matrix

| Query / engine op | Index |
|---|---|
| **Today** (mine, scheduled/overdue) | `tasks(workspace_id, assignee_id, scheduled_date) where deleted_at is null and status in ('scheduled','in_progress','waiting')` |
| **Overdue / Due soon** | `tasks(workspace_id, due_date) where deleted_at is null and status not in ('completed','archived') and due_date is not null` |
| **My Tasks** | `tasks(workspace_id, assignee_id, status) where deleted_at is null` |
| **Inbox** | `tasks(workspace_id) where status='inbox' and deleted_at is null` |
| **Team View** | `tasks(workspace_id, owner_user_id, status) where deleted_at is null` |
| **Client tasks** | `tasks(workspace_id, client_id) where client_id is not null and deleted_at is null` |
| **Subtasks** | `tasks(parent_id) where deleted_at is null` |
| **Active blockers** | `task_blockers(task_id) where resolved_at is null` |
| **Dependency traversal** | `task_dependencies(prerequisite_id) where resolved_at is null and removed_at is null`; `(dependent_id) where resolved_at is null and removed_at is null` |
| **Recurrence evaluator** | `recurring_definitions(next_occurrence) where mode='schedule' and active`; unique `tasks(recurrence_definition_id, occurrence_slot)` |
| **Reminder evaluator** | `task_reminders(state, remind_at) where state='pending'` |
| **Event history** | unique `task_events(task_id, aggregate_version, event_sequence)` |
| **Command idempotency** | unique `command_receipts(workspace_id, idempotency_key)`; `(expires_at)` for TTL sweep |
| **Redaction lookup** | `event_redactions(target_event_id)`; `(subject_kind, subject_ref)` |

**No speculative reporting indexes** — added when Reporting's real queries exist.

---

## 20. Type & Error Model (future TS)

**Bounded types** (mirror DB CHECKs exactly):
`TaskStatus = inbox|planned|scheduled|in_progress|waiting|completed|archived` · `TaskPriority = critical|high|normal|low` · `ResumeTarget = planned|scheduled` · `BlockerClass = person|client|approval|asset|dependency` · `DependencyKind = hard|info` · `ReminderState = pending|due|delivered|cancelled` · `ActorKind = user|automation|system` · `RecurrenceMode = completion|schedule` · `MissedPolicy = skip|roll` · `ArchiveReason = retention|cancelled`.

**Typed errors → origin:**

| Error | Origin |
|---|---|
| `IllegalTransition` | **domain validation** (state machine) |
| `MissingOwner` / `MissingAssignee` | domain validation (primary) + **DB CHECK** (backstop) |
| `ActiveChildren` | domain + **DB trigger** backstop |
| `DependencyCycle` | domain + **DB trigger** backstop |
| `VersionConflict` | **persistence operation** |
| `IdempotencyConflict` | **persistence operation** |
| `EventContractViolation` | **persistence operation** (structural event contract) |
| `CrossWorkspaceReference` | **DB composite FK** |
| `TaskNotFound` | domain / persistence op |
| `LegacyDataFound` | **migration preflight** (0035) |

---

## 21. Verification & Test Matrix

Extends the existing real-Postgres RLS harness (meetings/soft-delete pattern) + Vitest for the pure state machine.

| Test | Asserts |
|---|---|
| RLS admin+workspace access | admin sees own-workspace tasks only |
| Client/rep/anon denial | zero rows/zero write on every task table |
| Direct-write denial | authenticated INSERT/UPDATE on `tasks` rejected |
| Internal-op access | op works via service role; denied to authenticated |
| Task/event atomicity | failure rolls back both state and events |
| Two ordered events / one version | Waiting-completion writes `(v=k,seq=1)`+`(v=k,seq=2)` |
| Optimistic conflict | stale `expected_version` → `VersionConflict` |
| Command replay | same key+payload returns stored outcome, no double-apply |
| Same-key/different-payload | `IdempotencyConflict` (against an existing successful receipt) |
| **Failed txn leaves no receipt** | transient failure → no state/events, no receipt, key retryable |
| **No error-outcome rows** | `command_receipts.outcome` only ∈ {applied,replayed,accepted_noop} |
| **Event contract** | `CompleteTask` without `TaskCompleted` rejected; zero-event mutation rejected; wrong Waiting-completion order rejected; attribute-only command carrying a status change rejected; unknown command_type rejected |
| Waiting aggregation | multiple blockers → single Waiting; unblock only at zero |
| **Multiple external blockers** | two distinct `approval:*` blockers active at once; duplicate `blocker_key` is a no-op |
| Dependency auto-block/unblock | unmet hard edge blocks; prerequisite completion unblocks |
| **Dependency history / re-add** | resolved or removed edge can be re-added as a new-identity row; resolving/removing the last active hard edge clears the blocker; history rows persist |
| Subtask completion guard | parent completion rejected with active child (`ActiveChildren`) |
| Recurrence idempotency | duplicate `(definition, slot)` is a no-op |
| Event immutability | UPDATE/DELETE on `task_events` rejected |
| Safe event read redaction | redacted fields suppressed/masked; no raw JSON |
| **Safe event read authz** | non-admin authenticated denied; admin with null workspace denied; cross-workspace event ids not returned; raw `task_events`/`event_redactions` select by authenticated denied |
| **Completion survives retention** | retention-archived task still reports `completed_at`/`completed_by`; cancelled-archived has null completion; Restore clears current completion/archive metadata while events persist |
| Schema parity | clean-vs-prod diff = zero |
| Legacy preflight abort | 0035 aborts (`LegacyDataFound`) when legacy rows exist; no drops |

---

## 22. Rollout & Feature-Flag Plan

1. **Apply order:** `0035 → 0047` in numeric sequence (manual SQL editor, matching current practice), **after 0034**.
2. **Staging first:** apply all, run the full verification matrix + schema-parity, regenerate `database.types.ts`, typecheck/lint/build.
3. **Production:** manual application in order; 0035 no-ops (0027 absent); no prod data.
4. **Generated types:** regenerate after 0047 (replaces stale `Task/TaskStatus/TaskPriority`).
5. **Flags:** keep `PLANNER_ENABLED`; add a **`TASKS_ENABLED`** capability flag (request-time, like `isPlannerEnabled()`). Lenses read tasks **only when both are on**.
6. **Placeholder compatibility:** `My Tasks / Team / Inbox` routes stay placeholders until the domain + lenses ship and `TASKS_ENABLED` flips.
7. **Dark launch:** schema + op live in production behind `TASKS_ENABLED=false`; no surface exposed → no partial enablement.
8. **Rollback:** flag-off is primary; absent prod data, destructive rollback (drop new objects, reverse order) is safe.
9. **Enable criteria:** all gates green in staging + prod schema-parity + RLS proof + the atomic-op concurrency tests + at least the core lenses (My Tasks/Today/Inbox) implemented and reviewed.

---

## Technical Risks

- **Atomic-op correctness** (state+events+version+receipt+event-contract in one function) is the linchpin — needs the concurrency/atomicity/contract tests before any prod enable.
- **Manual migration at 13 files** — error-prone; mitigated by staging + schema-parity gate + strict ordering.
- **Typed-reference blockers + `blocker_key`** add CHECK complexity vs a polymorphic column — accepted for referential safety and multi-blocker support.
- **Cycle/one-level/parent-completion rules** live in the app with trigger backstops — a gap in either could persist an illegal graph.
- **Recurrence TZ/DST** even for simple rules.
- **Event schema drift** — needs disciplined per-type payload versioning.
- **`date` due** forecloses intraday deadlines until an additive `due_time`.
- **Redaction completeness** — the safe read model must be the *only* event surface, or raw payloads could leak.

## Open Implementation Decisions

1. Internal op as **SECURITY DEFINER** (service-role grant) vs a dedicated **internal DB role** — *lean: SECURITY DEFINER + service-role grant, matching `soft_delete_meeting`.*
2. `updated_at` via **DB trigger** vs stamped by the op — *lean: DB trigger (mechanical), op stamps the rest.*
3. `occurrence_slot` as **`date`** vs **`text` token** — *lean: `text` canonical format to cover both date- and sequence-based rules.*
4. Safe event read model as a **view** vs a **SECURITY DEFINER function** — *lean: function (explicit authz, keyset pagination, redaction join).*
5. Should `task_reminders` intent be **admin-readable** via a safe view, or fully service-role? — *lean: safe read for admins (visibility), engine columns hidden.*
6. `global_seq` on `task_events` — include as convenience or omit? — *lean: include, explicitly non-semantic.*
7. Backfill scope for `profiles.workspace_id` — **admins only** vs all profiles — *lean: admins only; clients/reps null.*

## Recommended Decisions (for approval)

1. Adopt the **13-migration map** (§1), first migration = **legacy supersession with abort-on-data** (§2), 0027 untouched.
2. **Core `tasks`** shape/renames per §4; **constrained text** for all bounded fields; **status-aware completion/archive constraints** (§5) that preserve completion through retention archival, with no stored `completed` boolean.
3. **Constraint catalogue** §5 with the **layer split** (DB structural, op mechanical, domain lifecycle) — no lifecycle logic in triggers.
4. **`blocker_key`-based blocker identity** (§7) supporting multiple external blockers; **typed nullable reference columns** — no polymorphic FK; same for the actor model (§13).
5. **Dependency history** with `removed_at`/`resolved_at` and **active-only uniqueness** (§8) — re-addable edges, retained history.
6. **Composite-FK workspace seam** on every intra-domain reference; `current_workspace_id()` **fail-closed**.
7. **Internal-only atomic op** per §16 (envelope + never-accepted fields + structural event contract + 9 steps); task tables **read-only RLS, all writes via the op**.
8. **Append-only events** + `(task_id, aggregate_version, event_sequence)` ordering; **safe read model with explicit in-function authorization** (§17) the only human surface; **redaction overlay** for privacy.
9. **Success-only command receipts** (§15) — `{applied, replayed, accepted_noop}`, no error rows; **30-day configurable** + **permanent recurrence business key**.
10. **RLS matrix** §18 (A+W read; SR engine; clients/reps zero).
11. **Verification matrix** §21 as the merge gate; **schema-parity CI test** proves convergence.
12. **Dark-launch behind `TASKS_ENABLED`**; enable only when all gates green.

---

## Final Alignment Confirmation

Reviewed against [`execution-model.md`](./execution-model.md), [`task-domain-architecture.md`](./task-domain-architecture.md), and [`persistence-architecture.md`](./persistence-architecture.md).

| Check | Verdict |
|---|---|
| Retention-archived completed tasks preserve completion facts | ✅ `completed_at`/`completed_by` retained under `archived/retention` (§5). |
| Cancelled-archived tasks not falsely reported as completed | ✅ Completion fields forced null under `archived/cancelled`. |
| Restore clears current completion/archive metadata but not history | ✅ Op clears row fields; `task_events` untouched. |
| Multiple approval/asset blockers representable | ✅ `blocker_key`-based active uniqueness (§7). |
| Dependency history retained; edges re-addable | ✅ `removed_at`/`resolved_at` + active-only uniqueness (§8). |
| Failed transactions leave no state/events nor misleading receipts | ✅ Success-only receipts; full rollback (§15/§16). |
| Every persisted state change has the correct ordered event sequence | ✅ Structural per-command event contract (§16). |
| Safe event reads cannot bypass admin/workspace authorization | ✅ Explicit in-function checks, fail-closed, no base-RLS reliance (§17). |
| Every approved lifecycle transition is persistable | ✅ 7-state constrained text + the internal atomic-apply path express all commands. |
| Every illegal transition remains structurally guarded | ✅ TS state machine + DB CHECKs + composite FKs + immutability trigger + write-lockdown RLS. |
| Workspace references cannot cross boundaries | ✅ `workspace_id` + composite FKs; `current_workspace_id()` fail-closed. |
| Current state and event history cannot diverge | ✅ One atomic transaction: version check → task+satellites+receipt+ordered events. |
| Production and clean environments converge | ✅ Defensive superseding migration (0035) + CI schema-parity test. |
| Clients and reps retain zero Task access | ✅ RLS gates `is_admin() AND workspace`; no client/rep policy anywhere; internal-only writes. |
| No contradiction with the Execution Model, Task Domain Architecture, or Persistence Architecture | ✅ Confirmed — these mechanics tighten completion/blocker/dependency/receipt/event-integrity/read-auth without altering any approved lifecycle, invariant, or principle. |

No contradictions remain across the four approved documents. This document is the implementation-blueprint source of truth for the Planner Tasks domain.
