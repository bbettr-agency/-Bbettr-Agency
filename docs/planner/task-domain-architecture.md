# Task Domain Architecture
### Phase B1 · business architecture · source of truth

| | |
|---|---|
| **Status** | Approved |
| **Phase** | B1 |
| **Purpose** | Permanent business architecture for the Planner Tasks domain |
| **Scope** | Headless domain rules and invariants; no implementation or persistence design |
| **Implementation status** | Pre-implementation |
| **Last updated** | 2026-08-02 |

**Companion documents.** The [Planner Execution Model](./execution-model.md) defines **product behaviour** (how the Planner behaves for the user). This document defines **domain behaviour and invariants** (how the Tasks engine works with every page deleted). The [Persistence Architecture](./persistence-architecture.md) defines **storage principles and security boundaries**. The [Schema & Migration Specification](./schema-and-migration-spec.md) defines the **exact implementation blueprint**. Future migrations, repositories, services, APIs, automations, and UI must conform to **all four**.

---

**Conformance.** This designs the engine that enforces [`docs/planner/execution-model.md`](./execution-model.md). Where this revision tightens a rule beyond what the Execution Model previously stated, the corresponding amendments (A–E) have been applied to the Execution Model so the two permanent documents stay aligned.

**Framing — the headless test.** The Task Domain is a headless engine: it accepts **commands**, enforces **invariants**, emits **events**, and answers **queries**. UI, API, database, reporting, and automation are adapters around it. Every rule below holds even if every React page is deleted.

---

## 1. Domain Philosophy

**What is a Task?** *The atomic unit of committed work* — a single, ownable, completable intention tracked from capture to closure. **Single** (one task = one done/not-done thing), **ownable** (one accountable party once past capture), **completable** (a terminal "done").

A Task is **not** a meeting (a time-boxed event, never "completed"), **not** a note (no commitment/lifecycle), **not** a project (a container/outcome), **not** a reminder (a nudge attached to work).

**Belongs to the domain:** authoritative task state & lifecycle; sole enforcement of legal transitions; scheduling semantics (created/scheduled/due + overdue derivation); ownership & assignment; dependencies & blocking; recurrence generation; emitting an event per meaningful change; exposing queryable facts for lenses & reporting.

**Does *not* belong:** rendering/UX/ranking presentation (lenses; Current-Focus *ranking* lives at the edge); time & calendar management (Meetings/Calendar); project outcomes/progress rollups (Projects); client/CRM data (Clients); triage UX (Inbox is a lens); reminder/notification delivery (a delivery service consumes `ReminderDue`); automation execution (Automation consumes events, issues commands); report computation/storage (Reporting); identity/authorization (Portal identity — the domain records *who*, never decides *may they*).

**Governing principles:** headless & UI-agnostic · state changes only through invariant-enforcing commands · event-first · derive-don't-store · the lifecycle is law, enforced in one place · small aggregates referenced by identity · append-only, immutable history.

---

## 2. Core Concepts

Concepts are placed relative to the **Task aggregate** (the consistency boundary changed as a unit). High-volume or independently-lived concepts sit outside it and reference the Task by identity.

| Concept | Definition | Placement | Phase |
|---|---|---|---|
| **Task** | Atomic unit of committed work; aggregate **root**. | Root | **v1** |
| **Priority** | Bounded importance value object (§7-priority). | In-aggregate | **v1** |
| **Effort estimate** | Optional expected size. | In-aggregate | v1 (captured, used later) |
| **Scheduling dates** | created / scheduled / due (§6). | In-aggregate | **v1** |
| **Assignment** | `(principal, role)` participations (§7). | In-aggregate set | **v1** (owner + assignee) |
| **Label** | Reusable tag; many-to-many. | Referenced value object | **v1** |
| **Waiting reason + `blocked_since`** | Why blocked (person/client/approval/asset/dependency). | In-aggregate | **v1** |
| **Dependency** | Directed edge between two tasks (blocks / depends-on). | Own concept (cross-aggregate) | **v1** (hard + informational) |
| **Subtask** | A **full Task** with a parent link; one level deep in v1 (§8-subtasks). | Separate Task | **v1** (shallow) |
| **Checklist item** | Lightweight in-task step, no lifecycle. | In-aggregate child | v1 / v1.1 |
| **Recurring definition** | Template that generates Task instances; **not a task**. | Own aggregate | **v1** (simple rules) |
| **Reminder** | Time-anchored nudge; delivered externally. | In-aggregate | **v1** (basic) |
| **Domain event** | Immutable record of something that happened. | Append-only log | **v1** (foundational) |
| **Workspace / Organization** | Tenancy boundary that owns every concept (§12). | Ambient invariant | **v1** (single active) |
| **Watcher / Comment / Attachment / Time entry / Reviewer / Approval** | Collaboration & workflow extensions. | Various | Future |

**v1 core:** Task, lifecycle, scheduling dates, priority, owner + assignee, labels, task-to-task dependencies, Waiting reason, recurring definition + generation, domain events, basic reminders, shallow subtasks, and the workspace boundary. **Deferred:** comments, attachments, time entries, watchers, reviewers/approvals, advanced recurrence, critical-path.

---

## 3. Domain Boundaries

A context map. The Task Domain integrates with neighbours **only by referencing identities** and never crosses a workspace boundary (§12).

| Context | Owns | Task Domain's relationship |
|---|---|---|
| **Task (this)** | Task existence, state, lifecycle, scheduling, ownership, dependencies, recurrence, events. | — |
| **Meetings** | Events, times, attendees, Google projection. | A task may **reference a meeting**; never stores meeting data. |
| **Projects** *(future)* | Project container/outcome; progress. | A task references **≤ 1 project**; progress computed by Projects/Reporting from task facts. Until Projects exists the reference is weak/unresolved (today's free-text is transitional, unmodelled). |
| **Clients** | Client/CRM data. | A task references **≤ 1 client**; owns none of its data. |
| **Calendar** | Google projection of meetings. | No task relationship in v1. |
| **Inbox** | Nothing — a **lens** over `Inbox`-state tasks. | Capture creates an `Inbox` task; triage is a domain command. |
| **Reporting** | Metrics, snapshots, trends. | Read-only consumer of facts + event stream. |
| **Automation** | Rules, conditions, execution. | Consumes events, issues commands via the same path as humans (§11-authz). |
| **Identity** | Users, teams, auth, workspaces. | References **principals** by id, records the actor, never authorizes. |

---

## 4. Business Rules (invariants)

**Existence & ownership**
- A task records an immutable **creator**.
- A task in any state **beyond `Inbox` has exactly one Owner** (a **principal** — user *or* team). `Inbox` tasks may be ownerless.
- A task has **≤ 1 primary Assignee** in v1. An **individual** assignee is **required before `In Progress`** (§7).
- Accountability with a null assignee rests on the **Owner**.

**Completion**
- Completion is **single & idempotent**; re-completing is a no-op. Concurrent completes resolve first-writer-wins (§10 concurrency).
- A `Completed` task returns to active only via **`ReopenTask` within the grace window**; thereafter only via **`RestoreTask`** from `Archived` (§5-Reopen/Restore).

**Lifecycle legality (the state machine, §5)**
- Only §5 transitions are permitted; every other is **rejected with a domain error**.
- **`Inbox` → `Scheduled` only via the atomic `TriageAndScheduleTask`** command supplying all post-Inbox fields (§5-triage). A raw dated schedule from `Inbox` is illegal.
- **`Waiting` → `In Progress` is never legal directly.** The only path is `Waiting → UnblockTask → (Planned|Scheduled) → StartTask → In Progress`.
- **`Waiting` → `Completed`** occurs only through the deliberate **atomic unblock-then-complete** rule (§5-complete-from-waiting).
- **Nothing returns to `Inbox`.** `Archived` is terminal except `RestoreTask`.
- **`StartTask` requires an individual assignee.**

**Scheduling & time**
- **Overdue is derived, never stored**, never set directly.
- **Rescheduling moves the scheduled date only; never the due date.**
- All day-boundary logic uses the **agency time zone** (`Africa/Johannesburg`).

**Structure**
- **Dependency graph acyclic**; no self-dependency.
- **Subtask hierarchy acyclic and exactly one level deep in v1.**
- A label appears on a task **at most once**.

**Recurrence** — a generated instance is **independent**; completing/editing an instance never mutates the definition; editing a definition never rewrites already-generated instances. Generation is **idempotent** (§5-recurrence).

**Tenancy** — every task and related concept belongs to **one workspace**; cross-workspace references, dependencies, and principals are **forbidden** (§12).

**History** — the event log is **append-only and immutable**.

**Never-violate crown jewels:** transition legality · acyclic dependency & hierarchy · single completion · event-log immutability · TZ-anchored derivation · no owned task without an owner · **no cross-workspace reference** · **atomic state+events persistence** (§10).

---

## 5. Lifecycle Enforcement

The domain is the **sole state machine**. State changes only via a command that (1) checks preconditions (guard), (2) applies the transition, (3) emits the event — atomically with state (§10).

**Commands ↔ transitions (final):**

| Command | Transition | Guard / validation |
|---|---|---|
| `CaptureTask` | — → **Inbox** | Title only. Ownerless allowed. Stamps workspace + creator. |
| `TriageTask` | Inbox → **Planned** | Requires **Owner**. Priority defaults to **Normal**. |
| **`TriageAndScheduleTask`** | Inbox → **Scheduled** *(atomic)* | Requires **Owner**, **scheduled date**, assignee policy (explicit assignee *or* explicit "leave unassigned"), priority (or default Normal). The **only** legal `Inbox → Scheduled` path. |
| `ScheduleTask` | **Planned** → **Scheduled** | Requires a scheduled date. *(No longer valid from `Inbox`.)* |
| `RescheduleTask` | Scheduled ↻ Scheduled | Moves scheduled date only; due untouched. |
| `UnscheduleTask` | Scheduled → **Planned** | Clears scheduled date. |
| `StartTask` | **Planned / Scheduled** → **In Progress** | **Requires an individual assignee.** Starting from `Planned` auto-sets today as scheduled. **Never valid from `Waiting`.** |
| `BlockTask` | Planned / Scheduled / In Progress → **Waiting** | Requires a reason; records `blocked_since` and a **resume target** ∈ {Planned, Scheduled} (blocking from `In Progress` records **Scheduled**, never `In Progress`). |
| `UnblockTask` | Waiting → **resume target** | Only when **no remaining blockers of any class** (§9). Restores the recorded resume target. |
| `DeferTask` | In Progress → Scheduled / Planned | Keeps/clears date per choice. |
| `CompleteTask` | Planned / Scheduled / In Progress → **Completed** | Idempotent; records actor; triggers recurrence (completion-driven) + retention timer. |
| `CompleteTask` *(from Waiting)* | Waiting → **Completed** *(atomic)* | Requires **blocker-resolution** data; performs **unblock-then-complete atomically**, emitting `TaskUnblocked` (with resolution) immediately followed by `TaskCompleted`. |
| `ReopenTask` | Completed → resume target | **Only within the grace window** (§5-Reopen). |
| `ArchiveTask` | Completed → **Archived** | On **retention** aging. **No recurrence responsibility.** |
| `DropTask` (cancel) | any active → **Archived (cancelled)** | Records a cancelled reason. |
| `RestoreTask` | Archived → **Planned** | Explicit; emits distinct `TaskRestored` (§5-Restore). |

**Illegal transitions (rejected):** anything → `Inbox`; `Inbox` → `In Progress`/`Waiting`/`Completed`; **`Inbox` → `Scheduled` except via `TriageAndScheduleTask`**; **`Waiting` → `In Progress` (direct)**; `Completed` → active except `ReopenTask` (in grace); `Archived` → anything except `RestoreTask`.

**Reopen / Archive / Restore (locked model):**
- **Grace window < retention window.**
- **[0 … grace]** — `Completed` and **reopenable** (`ReopenTask` → resume target).
- **(grace … retention]** — remains `Completed`, **visible**, but **not reopenable normally**.
- **> retention** — **auto-`ArchiveTask`** → `Archived`, leaves active surfaces, retained for Reporting.
- **`RestoreTask`** (from `Archived`) → **`Planned`**, distinct event. It **preserves** ownership and **due-date** (history intact) and **retains all historical events unchanged**; it **clears** the scheduled date, completion metadata, and any active-execution state. Cancelled-dropped tasks restore the same way.

**Recurrence generation (locked, single canonical owner — the definition):**
- **Completion-driven:** `TaskCompleted` is the trigger → the **recurrence reactor** generates the next instance into `Scheduled`. **Archiving has no recurrence role.**
- **Schedule-driven:** a **temporal evaluator** generates the instance at the configured time; completing an existing instance **does not** duplicate it.
- **Idempotency:** every generation carries a **generation key** = (definition id, occurrence slot); a repeated trigger with the same key is a **no-op**, so retries never double-create. A missed instance follows the definition's **skip / roll** policy.

**Overdue** has **no command** — it is a derived predicate. A temporal evaluator may emit `TaskBecameOverdue` for automation, but the *state* stays derived.

---

## 6. Scheduling Philosophy

| Term | Meaning | Behaviour |
|---|---|---|
| **Created** | The instant the task began to exist. | Immutable; enters `Inbox`; basis for lead time / backlog age. |
| **Scheduled** (`scheduled_date`) | *Intent to work.* | Optional; freely movable (no moral weight); drives Today when `== today`. |
| **Due** (`due_date`) | *Commitment / deadline.* | Optional; independent of scheduled; moving it is renegotiation; sole input to Overdue. |
| **Started** | First `In Progress`. | Momentum; start of cycle time. |
| **Completed** | Closure. | Cycle/lead-time end; triggers **completion-driven** recurrence + retention timer. |
| **Archived** | Retention closure. | Leaves active surfaces; retained for Reporting. |
| **Waiting / Blocked** | Progress impossible. | Records `blocked_since` + resume target; **excluded** from Current Focus & workload/realistic-completion math. |
| **Overdue** | Derived predicate. | `has due_date AND due_date < today(agency TZ) AND state ∉ {Completed, Archived}`. Not cleared by reschedule; may overlay `Waiting` ("overdue because blocked"). |
| **Recurring** | Definition-driven regeneration. | Each instance independent; missed follows skip/roll. |

**Interactions:** *due today / scheduled tomorrow* → not overdue today; *due yesterday / scheduled today* → Overdue **and** on Today (rolling the plan never launders the due date). **Today membership** = `scheduled_date == today` OR `overdue` OR explicitly pulled. Grace, retention, and "today" boundary are **configuration**, not constants.

---

## 7. Assignment & Priority

**Assignment — `(principal, role)` participations. Locked v1 rules:**

| Role | Meaning | Cardinality | Phase |
|---|---|---|---|
| **Creator** | Who captured it. | 1, immutable | v1 |
| **Owner** | *Accountable.* User **or team**. Mandatory beyond `Inbox`. | 1 | v1 |
| **Assignee** | *Responsible / doing.* Optional while Planned/Scheduled; **individual required before `In Progress`.** | ≤ 1 | v1 |
| Collaborator / Watcher / Reviewer / Approver | — | Many | Future |

- **If Owner is a team**, an **individual Assignee must be set before `StartTask`** (the domain rejects `Start` otherwise). Planned/Scheduled tasks **may remain unassigned**.
- **When Assignee is null, the Owner is accountable.**
- **Changing Assignee does not change Owner**, and vice-versa: **`TaskOwnerChanged` and `TaskAssigned` are separate commands and separate events**. Assignment churn and ownership churn are distinct reporting facts.

**Priority — locked canonical v1 model (four bounded values):**

| Value | Meaning |
|---|---|
| **Critical** | Immediate operational risk or a hard deadline. |
| **High** | Important and time-sensitive. |
| **Normal** *(default)* | Standard work. |
| **Low** | Useful but deferrable. |

- **Default = Normal.** *"Someday" is not a priority* — that is a planning/scheduling state, not importance.
- **Changeable** by the Owner or an otherwise-authorized principal (the app layer authorizes; §11); every change emits `TaskPriorityChanged`.
- **Critical requires a recorded reason.**
- **Priority never overrides blocked state in Current-Focus eligibility** — a `Waiting` task is ineligible regardless of priority.

---

## 8. Dependency & Subtask Semantics

**Dependencies** are directed edges between Task aggregates, resolving **eventually** (event-driven), never in one cross-task transaction.

- **Hard (blocking):** "B depends on A" ⇒ B cannot progress until A completes.
- **Soft (informational):** surfaced to humans, ignored by the state machine.
- **External blocker:** *waiting-on-client / approval / asset* — a `Waiting` **reason** with no internal edge.

**Auto-blocking (locked):**
- Adding an **unmet hard dependency** to a **currently-actionable** dependent **auto-transitions it to `Waiting`** (reason: dependency) and **records its prior actionable state** as the resume target (Planned/Scheduled; from `In Progress` → Scheduled, honouring the no-direct-resume rule).
- **Manual and dependency blockers coexist.** A task carries potentially several blockers across classes.
- **`UnblockTask` succeeds only when *all* blocker classes are resolved.** Resolving the **last** hard blocker (via `DependencyResolved`, reacting to the blocker's `TaskCompleted`) **auto-restores** the recorded resume target and re-enables Current-Focus eligibility.
- **Idempotent:** repeated resolution/retry never emits duplicate `TaskBlocked` / `TaskUnblocked` (guarded by blocker set + generation/idempotency keys, §10).
- **Project dependencies** and **critical-path** are deferred (graph exposed; Reporting computes path).

**Subtasks (simplest safe v1, locked):**
- A subtask is a **full Task with a parent link; exactly one level deep** (a subtask cannot have subtasks).
- **A parent may not be `Completed` while any child remains active** — the domain **rejects** the completion (no override in v1; an override-with-reason is a documented future option). In v1 **all children are required** blockers of parent completion.
- **Completing all children does not auto-complete the parent** (no auto policy in v1).
- **Parent and child lifecycles are otherwise independent.**

---

## 9. Domain Events

Event-first: the log is the audit trail **and** the integration contract. Events are **past-tense, immutable, append-only**, each carrying (conceptually) **task id, workspace id, acting principal, timestamp, aggregate version, and causation/correlation ids** (§10, §12).

**Lifecycle:** `TaskCaptured` · `TaskTriaged` · `TaskScheduled` · `TaskRescheduled` · `TaskUnscheduled` · `TaskStarted` · `TaskBlocked` · `TaskUnblocked` · `TaskDeferred` · `TaskCompleted` · `TaskReopened` · `TaskArchived` · `TaskDropped` · `TaskRestored`
**Assignment:** `TaskOwnerChanged` · `TaskAssigned` · `TaskUnassigned`
**Attributes:** `TaskRenamed` · `TaskDescriptionEdited` · `TaskPriorityChanged` · `TaskDueDateChanged` · `TaskEstimateChanged` · `TaskLabeled` · `TaskUnlabeled`
**Structure:** `SubtaskAdded` · `ChecklistItemAdded` · `ChecklistItemChecked` · `DependencyAdded` · `DependencyRemoved` · `DependencyResolved`
**Recurrence:** `RecurringDefinitionCreated` · `RecurringDefinitionUpdated` · `RecurringInstanceGenerated` · `RecurringInstanceMissed`
**Temporal / derived (evaluator, not a command):** `TaskBecameOverdue` · `ReminderDue`
**Future:** `CommentAdded` · `AttachmentAdded` · `WatcherAdded` · `ApprovalRequested/Granted/Rejected` · `TimeEntryStarted/Stopped`

*The atomic completion-from-`Waiting` (§5) emits `TaskUnblocked` then `TaskCompleted` as one indivisible pair.* Internally fine-grained events may exist; externally a **curated integration-event subset** is the stable contract.

---

## 10. State/Event Atomicity & Concurrency (architectural invariant)

Even though the mechanism is B2, the **guarantees** are locked now:

- **Atomic state + events:** a successful command persists **(1) the new current Task state and (2) all emitted events as one indivisible operation** — both succeed or neither does. No event without its state change; no state change without its events.
- **Aggregate version / optimistic concurrency:** each task carries a monotonically increasing **version**; a command asserts the expected version and is rejected on mismatch (this is how first-writer-wins completion and duplicate-prevention are enforced).
- **Command idempotency key:** every command carries an idempotency key; a replay with the same key returns the original outcome without re-applying (safe retries, offline replay, automation loops).
- **Event versioning:** each event type is **schema-versioned** so the append-only log can evolve without breaking consumers.
- **Ordering:** events are **strictly ordered per task** (per-aggregate sequence). **No global ordering is promised** across tasks — cross-task reactions (dependency unblocking) are eventually consistent.

---

## 11. Authorization Boundary

Two distinct checks, deliberately separated:
- **Authorization — "*may* this actor issue this command?"** — lives in the **application layer**, checked **before** the domain is called.
- **Domain invariant — "is this command *legal* for this task?"** — lives in the **domain**, checked **always**, regardless of who issued it.

The domain **receives and records the acting principal** but never authorizes. It **rejects structurally invalid commands** even from a fully-authorized actor. **Automations and AI agents use the identical authorization + command path as humans** — same guards, same events, same actor recording (as an automation principal). There is no privileged back door.

---

## 12. Tenant Boundary (permanent invariant; not implemented now)

- **Every Task and every related concept belongs to exactly one Workspace/Organization.**
- **Cross-workspace task references and dependencies are forbidden** — a dependency, parent link, or reference whose endpoints span workspaces is rejected.
- **All principals on a task must belong to the same workspace.**
- **Every event carries the workspace identity.**
- **All queries and commands are workspace-scoped** by construction.

Single active workspace today; this seam makes departments and multiple businesses a **partition, not a rewrite**.

---

## 13. Automation & Reporting Surfaces

**Automation surface** — two seams only: **subscribe to events** (§9; highest-value: transitions, assignment changes, `TaskBecameOverdue`/`ReminderDue`, `DependencyResolved`, recurrence events) and **issue commands** (§5, via the §11 path). Guardrails: recorded principal, commands-only, causation ids for loop detection, idempotency.

**Reporting surface** — the domain exposes **facts + the event stream**; Reporting computes/stores metrics & the snapshots trends require (never fabricated by the domain): throughput/velocity, completion rate, cycle time (`Started→Completed`), lead time, overdue count/age, Waiting duration (`blocked_since→Unblocked`), workload (open/effort per owner/assignee/project/client), recurring adherence (generated vs completed vs missed), aging, reschedule/reassignment churn, and time-in-state (reconstructed from the log).

---

## 14. Future Scalability

Headless domain → mobile / public API / AI are new adapters. Workspace seam → departments & multi-business as partitions. Owner-as-principal → queues. Event-first append-only log → audit, offline sync, integrations, AI context, temporal reporting. Small identity-referenced aggregate → shards by workspace, scales to millions. CQRS-leaning read models → per-lens & reporting projections scale independently. Idempotent commands + aggregate versioning + causation ids → safe retries, offline replay, loop protection. TZ-aware → multi-region. Curated integration events → external webhooks without exposing internals. Current-Focus ranker pluggable at the edge → heuristic today, AI tomorrow, same seam.

---

## Decisions Locked

1. **Inbox → Scheduled** — allowed **only** via the atomic **`TriageAndScheduleTask`** command (Owner + scheduled date + assignee policy + priority/default). Plain `ScheduleTask` is **Planned → Scheduled** only. A raw dated `Inbox` schedule is illegal.
2. **Waiting → In Progress** — **never direct.** Only `Waiting → UnblockTask → (Planned|Scheduled) → StartTask → In Progress`. `StartTask` also requires an individual assignee. "Waiting(resume)" is removed from `StartTask`.
3. **Waiting completion** — permitted only through a deliberate **atomic unblock-then-complete**: `CompleteTask` from `Waiting` requires blocker-resolution data and emits **`TaskUnblocked` → `TaskCompleted`** as one indivisible pair.
4. **Recurrence generation** — the **definition owns generation.** Completion-driven: `TaskCompleted` → reactor generates next. Schedule-driven: temporal evaluator generates at time. **Archiving has no recurrence role.** Generation is idempotent via (definition id, occurrence slot); no duplicates on retry.
5. **Reopen / Archive / Restore** — **grace < retention.** Reopenable within grace; visible-but-not-reopenable until retention; **auto-Archived** after retention. **`RestoreTask` → Planned** (distinct event): **preserves** ownership + due-date + all historical events; **clears** scheduled date, completion metadata, and execution state.
6. **Owner vs Assignee** — Owner mandatory beyond `Inbox`, may be user **or team**; Assignee optional while Planned/Scheduled; **individual Assignee required before `In Progress`**; a null Assignee leaves the **Owner** accountable; **owner change and assignment are separate commands/events**.
7. **Priority** — **Critical / High / Normal (default) / Low.** No "Someday." Owner/authorized principal changes it (`TaskPriorityChanged`); **Critical requires a reason**; priority **never** overrides `Waiting` ineligibility in Current Focus.
8. **Subtask completion** — subtasks are full tasks, **one level deep**; **parent cannot complete while any child is active** (rejected, no v1 override); completing all children **does not** auto-complete the parent; lifecycles otherwise independent.
9. **Dependency auto-blocking** — an unmet hard dependency on an actionable dependent **auto-`Waiting`**, recording the prior actionable state; manual + dependency blockers coexist; unblock **only when all blocker classes clear**, then auto-restore; idempotent (no duplicate block/unblock events).
10. **Event atomicity** — new state **and** all events persist **as one indivisible operation**; per-task ordering; aggregate versioning/optimistic concurrency; command idempotency keys; versioned events; **no global cross-task ordering**.
11. **Authorization** — app layer authorizes ("may this actor?"); domain enforces legality ("is this legal?") and records the actor; automations/AI use the same authz + command path.
12. **Tenant boundary** — every concept belongs to one workspace; **no cross-workspace references/dependencies/principals**; events carry workspace id; all commands/queries workspace-scoped.

---

## Consistency Review against `docs/planner/execution-model.md`

This architecture **tightens** several rules the Execution Model previously stated more loosely. Its lifecycle §3 has been brought into exact alignment via the following **five amendments (A–E), now applied** to `execution-model.md`:

- **A. `Waiting → In Progress`.** Execution Model §3.3 matrix previously showed `Waiting → In Progress ✓ resume`. **Removed** — direct resume is illegal (Decision 2). Route via Planned/Scheduled.
- **B. Unblock target.** Execution Model §3.4's "prior actionable state" is **clarified** to exclude `In Progress` — the resume target is always **Planned or Scheduled** (blocking from `In Progress` records Scheduled). This keeps A consistent.
- **C. Archiving & recurrence.** Execution Model §3.6's clause that archiving "fires the recurring-regeneration" is **removed** — recurrence is **completion-driven or schedule-driven only**; **archiving handles retention/removal exclusively** (Decision 4). §3.5 clarified accordingly.
- **D. `Inbox → Scheduled`.** Execution Model §3.3's `quick-schedule` cell is **annotated** to require the atomic `TriageAndScheduleTask` (Owner + assignee policy + priority + date), not a bare date (Decision 1).
- **E. Waiting completion & Start guard.** Execution Model §3.3/§3.4 **annotated** that `Waiting → Completed` is the atomic unblock-then-complete pair (Decision 3), and that `→ In Progress` requires an individual assignee (Decision 6).

**No other contradictions.** Confirmed consistent: the seven-state lifecycle, Overdue-as-derived-flag (§3.2), due-vs-scheduled independence (§6 both docs), Waiting = canonical Blocked with reason + `blocked_since` (§3.4), recurrence entering at Scheduled / regenerating at Completed or on schedule (§3.5, archiving explicitly excluded per C), `Restore → Planned` (§3.3), the lens/one-question/derive-don't-store principles (§1–2), and the honesty guardrail (Reporting owns trends/snapshots). The priority values (Decision 7) *fill a gap* the Execution Model left open — an addition, not a conflict.
