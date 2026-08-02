# Planner module (internal, admin-only)

Part of the **Bbettr OS** integration — the internal operations Planner (tasks,
meetings, Google Calendar / Meet) merged into the Portal as an **admin-only**
module for the internal team. Built phase by phase per
`BBETTR_OS_IMPLEMENTATION_SPEC.md`.

## Ownership boundary

- **Consumes shared Portal services** (never forks them): `@/lib/auth`
  (`requireAdmin`), `@/lib/supabase/{server,client,admin}`,
  `@/components/layout/AppShell`, `@/components/ui/*`, `@/lib/utils`.
- **Planner-owned namespaces** (added in their phases): `@/lib/tasks/*`,
  `@/lib/google/*`, `@/lib/planner/*`, `@/components/planner/*`,
  `@/app/(admin)/admin/planner/*`, `@/app/api/google/*`.
- **Never touches** the Client Portal, Rep Portal, or their auth/navigation.

## Planner sources of truth (execution side)

Four permanent documents govern the Planner's execution surfaces. All future
**Tasks**, migrations, repositories, services, APIs, automations, and UI work
**must conform to all four**:

- **Product behaviour** —
  [`docs/planner/execution-model.md`](../../../docs/planner/execution-model.md):
  the Planner-wide architectural principles ("pages are lenses, not stores"), the
  one-question-per-page rule, the canonical task lifecycle, and the Today page
  (Morning Planning, Current Focus, Waiting/Blocked, Quick Capture, End-of-Day
  Review).
- **Domain behaviour & invariants** —
  [`docs/planner/task-domain-architecture.md`](../../../docs/planner/task-domain-architecture.md):
  the headless Task Domain — concepts, boundaries, lifecycle enforcement,
  scheduling, assignment/priority, dependencies/subtasks, events, atomicity,
  authorization, and the tenant boundary.
- **Persistence & data model** —
  [`docs/planner/persistence-architecture.md`](../../../docs/planner/persistence-architecture.md):
  storage principles and security boundaries — aggregate persistence, the
  internal-only atomic write boundary, ordered immutable events, optimistic
  concurrency, the workspace boundary, RLS/security, and the privacy-redaction
  overlay.
- **Schema & migration blueprint** —
  [`docs/planner/schema-and-migration-spec.md`](../../../docs/planner/schema-and-migration-spec.md):
  the exact implementation blueprint — the `0035–0047` migration map, the
  concrete `tasks` and satellite tables, constraint catalogue, `blocker_key`
  identity, dependency-history semantics, the internal atomic-operation contract
  and structural command/event integrity catalogue, the RLS and index matrices,
  verification suite, and rollout plan.

The Execution Model defines *how the Planner behaves*; the Task Domain
Architecture defines *how the Tasks engine works*; the Persistence Architecture
defines *storage principles and security boundaries*; the Schema & Migration
Specification defines *the exact implementation blueprint*.

**Migration `0027_planner_tasks.sql` is superseded** by the approved Task Domain
persistence model (see the Schema & Migration Specification, §1–§2). The
historical `0027` migration itself **remains completely untouched**. Migration
`0035_planner_tasks_supersede_legacy` (first of the approved `0035–0047` map,
after `0034`) will perform the defensive preflight and empty-schema removal;
**unexpected legacy rows abort deployment**; clean/test and production converge,
proven by a **schema-parity test**. **No migration implementation exists yet.**

## Status

Phase 0 — scaffolding only (dependencies, feature flag, this namespace, env
documentation). No runtime code, no routes, no UI. Everything is gated by
`PLANNER_ENABLED` (`@/lib/flags`) and remains invisible until later phases.

## Planner Overview — deferred sections (Phase B / C)

The Overview (`/admin/planner`) is **Phase A: meetings + calendar only** — it
renders exclusively from real meeting rows, safe projection views, Google
connection status, and admin profiles. The following were intentionally **not**
built because no honest data source exists yet. Do NOT fake them.

**Phase B — requires the Tasks domain**
- Deploy migration `0027_planner_tasks` to production (not applied yet), then
  build a Planner tasks domain (queries/actions; real My Tasks / Team View /
  Inbox pages). Convention (agreed): treat `tasks.scheduled_date` as the working
  due date unless a task-domain audit proves separate scheduled/due dates are
  needed.
- Then add: **Open Tasks / Due Today / Overdue / Completed This Week** KPIs; the
  task side of **Team Workload** (task counts + Normal/Busy/Needs-Attention
  classification); task-based briefing/insight lines; and **Upcoming Deadlines**.

**Phase C — requires a Projects model**
- **Project Attention** needs a Planner "project" entity linking meetings/tasks
  to clients (today `tasks.client_or_project` is free text, not a FK) plus a
  stage/last-activity concept. Not renderable honestly until that exists.

**Explicitly deferred (never fabricate):** Team Capacity %, Project %,
historical productivity, completion trends, and any "increased/decreased/trend"
language (needs periodic snapshots that don't exist).
