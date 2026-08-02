# Planner — Execution Model & Today Page
### Product Specification · pre-implementation · source of truth

| | |
|---|---|
| **Status** | Approved |
| **Purpose** | Permanent product source of truth for Planner execution behaviour |
| **Scope** | Planner-wide principles plus the Today page |
| **Implementation status** | Pre-implementation |
| **Last updated** | 2026-08-02 |

**Companion document.** This document defines **product behaviour** (how the Planner behaves for the user). The [Task Domain Architecture](./task-domain-architecture.md) defines **domain behaviour and invariants** (how the Tasks engine works with every page deleted). Future persistence, services, APIs, automations, and UI must conform to **both**.

---

**Scope note.** Part I (Architectural Principles, One-Question-Per-Page, the Canonical Task Lifecycle) is **Planner-wide** and governs every page. Part II specifies the **Today** page. Part III covers forward-compatibility, dependencies, and success. Nothing here is a database or code design — those follow in the separate Tasks-domain session.

---

# PART I — FOUNDATIONS (Planner-wide)

## 1. Architectural Principles

These principles bind all Planner development. They exist to prevent duplicated logic, contradictory behaviour, and pages that quietly become their own databases.

**P1 — Pages are lenses, never stores.** Every page is a *projection* — a filtered, ranked, or grouped view — over data owned by a domain. A page holds no authoritative state of its own.

| Lens (page) | Projects from | Into a view of… |
|---|---|---|
| **Overview** | Meetings, Calendar projections, (later) Tasks | Agency health |
| **Today** | *My* Tasks + *my* Meetings | Personal execution |
| **Calendar** | Meetings | Time / scheduling |
| **My Tasks** | *My* Tasks (all states) | Ownership / backlog |
| **Team View** | Everyone's Tasks + Meetings | Distribution / delegation |
| **Inbox** | Tasks in the *Inbox* state | Triage queue |
| **Projects** | Tasks + Meetings grouped by project + Clients | Progress |

**P2 — Domains are the single source of truth.** The Tasks domain, Meetings domain, (future) Projects domain, and Clients domain own all state and all transitions. When Today "moves a task to tomorrow," it calls a Tasks-domain action; it does not mutate a local copy.

**P3 — One write path per concept.** A given kind of change has exactly one entry point. Quick Capture is the only task-creation front door on execution surfaces, and it writes one thing (an Inbox task). Lifecycle changes go through domain actions. This is what makes behaviour predictable across lenses.

**P4 — Derive, never duplicate.** Overdue status, counts, "busiest," project progress % — all are *computed at read time* from source data (pure functions, exactly like the Overview's `meeting-metrics.ts`), never stored on a page or copied between pages. Stored derivations drift; derived ones cannot.

**P5 — Lenses may differ in shape but never in truth.** Two pages showing the same task must reflect the same state, because they read the same source. If they ever disagree, that is a defect *by construction* — which is the point: the architecture makes contradiction hard.

**Consequence.** Business logic lives in domain services; shared read logic lives in reusable pure functions; UI lives in lenses. The Overview already embodies this (no stored aggregates, pure metrics over live meetings). Every future page inherits the same discipline.

---

## 2. The One-Question-Per-Page Principle

**Rule:** every Planner page answers **exactly one** primary question. Supporting information is permitted only when it *serves* that question.

| Page | The one question |
|---|---|
| **Overview** | How is the agency performing? |
| **Today** | What should I do right now? |
| **Calendar** | When does everything happen? |
| **My Tasks** | What work do I own? |
| **Team View** | What is everyone working on? |
| **Inbox** | What has not yet been processed? |
| **Projects** | How are projects progressing? |

**As a design test for any new feature:** "Which single question does this serve?" If it serves one page's question, it belongs there. If it serves none, it needs its own home — or it doesn't belong in the Planner.

**As an architectural smell detector:** when a page starts answering unrelated questions, split it. *Example, already applied:* Today shows meetings because they shape "what do I do now" — but it deliberately does **not** offer meeting management, because "when/how do I schedule meetings" is the Calendar's question. That restraint is the principle working.

---

## 3. The Canonical Task Lifecycle

One official lifecycle governs every task, everywhere. Today, My Tasks, Inbox, Team View, Projects, Reporting, and Automations all read from — and transition through — these same states.

### 3.1 The seven states

| State | Meaning | Primary home |
|---|---|---|
| **Inbox** | Captured but unprocessed. May lack owner, project, priority, or date. No commitment. | Inbox |
| **Planned** | Processed and owned (has project/priority/assignee) but *no working date*. The backlog. | My Tasks |
| **Scheduled** | Has a working date (scheduled) and/or a due date. Eligible to appear on Today. | Today / My Tasks |
| **In Progress** | Actively being worked (Start pressed). Drives momentum, later time-tracking. | Today |
| **Waiting** | Cannot progress — blocked on a person, client, approval, asset, or dependency. | Today (Blocked) / My Tasks |
| **Completed** | Finished. | Completed Today, then archives |
| **Archived** | Closed out (completed-and-aged, or cancelled). Out of active surfaces; retained for Reporting. | Reporting only |

> **Naming:** *Waiting* is the canonical state; "Blocked" is its user-facing synonym. §II-Blocked and this state are the same thing.

### 3.2 Two overlays that are **not** states

- **Overdue** is a *derived flag*, not a state — computed as `due date < today AND not Completed/Archived`. It overlays **Planned / Scheduled / In Progress / Waiting**. It is cleared only by completing, archiving, or moving the due date. Crucially, **rescheduling the *plan* date does not clear Overdue** — a task due today that rolls to tomorrow stays visibly overdue. This keeps missed deadlines honest.
- **Recurring** is a property of a *definition*, not a state. See §3.5.

### 3.3 Transition matrix

| From ↓ / To → | Inbox | Planned | Scheduled | In&nbsp;Progress | Waiting | Completed | Archived |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Inbox** | — | ✓ triage | ✓ triage-and-schedule¹ | ✗ | ✗ | ✗ | ✓ discard |
| **Planned** | ✗ | — | ✓ add date | ✓ (auto-schedules today)² | ✓ block | ✓ quick-done | ✓ drop |
| **Scheduled** | ✗ | ✓ unschedule | ↻ reschedule | ✓ start² | ✓ block | ✓ done | ✓ drop |
| **In Progress** | ✗ | ✓ backlog | ✓ pause/defer | — | ✓ block | ✓ done | ✓ cancel |
| **Waiting** | ✗ | ✓ unblock→backlog | ✓ unblock→dated | ✗ (never direct) | — | ✓ done³ | ✓ drop |
| **Completed** | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✓ auto-age |
| **Archived** | ✗ | ✓ restore | ✗ | ✗ | ✗ | ✗ | — |

¹ **Inbox → Scheduled** occurs **only** through the atomic *triage-and-schedule* command, which must supply every required post-Inbox field (owner, assignee policy, priority/default, and the scheduled date). A raw Inbox task can never become Scheduled with only a date. *(See Task Domain Architecture, Decision 1.)*

² **Entering In Progress requires an individual assignee.** Starting a Planned task auto-schedules it to today. *(See Task Domain Architecture, Decision 6.)*

³ **Waiting → Completed is an atomic unblock-then-complete flow:** the external blocker is recorded as resolved and the task is completed in one indivisible step, emitting *unblocked* immediately followed by *completed*. *(See Task Domain Architecture, Decision 3.)*

**Key invalid transitions (and why):**
- **Anything → Inbox.** Inbox is raw capture; processed work never regresses to unprocessed. (To "reset" a task, clear its date/details — it stays Planned.)
- **Inbox → In Progress / Waiting / Completed.** You cannot actively work, block, or finish an untriaged item — it must first become Planned or Scheduled. (A trivial capture is *triaged then* completed, not completed raw.)
- **Waiting → In Progress (direct).** A blocked task is never resumed straight into work. The only legal path is *Waiting → unblock → Planned/Scheduled → start → In Progress*.
- **Completed → any active state**, except a controlled **Undo** within a grace window. Undo is a deliberate reversal, not a free-flowing transition.
- **Archived → anything** except an explicit **Restore** (→ Planned). Archive is effectively terminal.

### 3.4 Where Overdue and Waiting "fit" (explicit answers)

- **Overdue:** a flag layered on any active, past-due task. A task can be *Scheduled + Overdue*, *In Progress + Overdue*, or *Waiting + Overdue*. The last case is important — a blocked task can still be overdue; the UI frames it as *"overdue because blocked,"* directing the user to chase the blocker, not themselves.
- **Waiting/Blocked:** a first-class state, entered from Planned/Scheduled/In Progress with a structured reason (waiting-on-person, -client, -approval, -assets, -dependency) and a `blocked_since`. It is **excluded from Current Focus and from realistic-completion math**. On unblock (manual, or a dependency completing), it auto-returns to its **prior actionable state — Planned or Scheduled only, never In Progress** (a task blocked while In Progress resumes to Scheduled and must be explicitly started again) — and becomes Focus-eligible. *(See Task Domain Architecture, Decision 2.)*

### 3.5 Recurring tasks — where they regenerate

A **recurring definition** is a template, not a lifecycle task. It **generates dated instances** directly into the **Scheduled** state; each instance then flows through the lifecycle independently. Generation is owned by the definition and happens in exactly one of two ways: **completion-driven** (completing an instance triggers generation of the next) or **schedule-driven** (a temporal evaluator generates the instance at the configured time; completing an existing instance never duplicates it). **Archiving never generates anything.** A **missed** instance follows the definition's policy — **skip** (don't carry) or **roll** (persist and become Overdue). Recurring tasks therefore *enter* at Scheduled and *regenerate* at the Completed boundary or on schedule. *(See Task Domain Architecture, Decision 4.)*

### 3.6 How Completed tasks archive

A Completed task remains in **Completed Today** for the day, then **auto-archives** after a retention window (configurable). **Archiving handles only retention and removal from active surfaces — it has no recurrence responsibility** (recurrence is completion- or schedule-driven, per §3.5). Archived tasks leave all active surfaces but remain queryable for **Reporting**. Cancelled tasks archive with a *cancelled* reason to distinguish them from genuine completions in reporting. *(See Task Domain Architecture, Decision 4.)*

### 3.7 How each surface reads the lifecycle

- **Inbox** → tasks in *Inbox*.
- **Today** → *my* tasks in *Scheduled/In Progress* dated today, *Waiting* (blocked section), plus any *Overdue*; *Completed* today in the momentum section.
- **My Tasks** → all my *Planned/Scheduled/In Progress/Waiting* (the full backlog).
- **Team View** → the same, across everyone.
- **Projects** → tasks of any active state grouped by project, for progress.
- **Reporting** → primarily *Completed/Archived* over time.
- **Automations** → fire on transitions (e.g., entered Waiting, became Overdue, Completed).

Everything downstream is a lens over this one lifecycle.

---

# PART II — THE TODAY PAGE

## 4. Page Philosophy

Today is the surface a person **executes** from. It answers **"What do I do right now?"** and re-answers it every time the user looks up from work. It is personal, present-tense, and ephemeral — it resets daily and never asks the user to plan the far future or manage the past.

Its governing constraint is **decision minimisation**: every element either *tells the user what to do* or *gets out of the way*.

Per P1, **Today is a lens.** Tasks and meetings live in their domains; Today projects a ranked slice for execution. The **only** thing Today writes is a Quick Capture (an Inbox task) — which keeps it from ever degrading into a backlog. Its separation from the other pages is defined by the One-Question table (§2): **My Tasks is the library; Today is the reading desk.** A task reaches Today only because it is *scheduled today, due today, overdue, or explicitly pulled into today*.

---

## 5. The Daily Arc (user journey)

Today supports a full workday without the user reorganising it. Two moments are now **formal workflows** (§6, §14); the rest are the execution loop between them.

1. **Morning Planning (§6)** — the day opens with a proposed plan the user accepts or edits. Decision fatigue is spent here, once, deliberately.
2. **Execution** — the core loop: *look at Current Focus → do it → complete → the next best action promotes automatically*. No re-deciding.
3. **Meetings** — as one approaches, the page surfaces it (prepare/join), then returns the user to their place.
4. **Breaks / context-switches** — Quick Capture absorbs stray thoughts into Inbox without derailing the current task.
5. **Afternoon reassessment** — the realistic-completion signal shows what can still finish, so scope is cut deliberately, not discovered at 5pm.
6. **End-of-Day Review (§14)** — the day is closed intentionally: what's done, what rolls, what's blocked and needs a nudge, a final capture sweep, and a preview of tomorrow.

---

## 6. Morning Planning Workflow

The most valuable moment in the Planner: the day begins with the system proposing the plan, and the user **editing a proposal rather than building one from scratch**.

**Concept:**

> **Good morning, Eloff.**
> Today you have **8 tasks · 2 meetings · 1 overdue item**.
> Planner recommends:
> ☑ Finish Vision Motors homepage ☑ Prepare Fine Art meeting ☑ Send MacBuild invoice
> **[ Accept plan ]  [ Edit plan ]**

**What it proposes.** A ranked, *realistically sized* committed set drawn from: overdue items (always surfaced), tasks scheduled/due today, meeting-prep for today's meetings, and the Current-Focus ranker's top picks from the backlog. It leads with the day's shape (tasks / meetings / overdue) so the user grasps the load before the list.

**When it appears.** On the **first meaningful Today open of a working day**, when no accepted plan exists yet. It is proactive but singular — the front door of the day, not a per-load interruption. It is also manually invokable anytime via **"Plan / Re-plan day."**

**When it disappears.** On **Accept** or explicit **"Start without a plan."** It then collapses into the normal Today view (the committed set becomes "Must do today," §9). It does not reappear that day unless the user re-invokes it.

**How often.** Once per working day, proactively; unlimited on demand. It never appears on non-working days.

**Accept vs Edit.** *Accept* commits the proposed set into **Must do today**. *Edit* lets the user add/remove/reorder, pull from Inbox or My Tasks, and defer — always modifying the proposal, never starting blank.

**Interaction with the committed set (§9).** Morning Planning *is* how "Must do today" gets populated. Items not chosen stay in **Could do / stretch** or remain in their My Tasks state (Planned/Scheduled). Accepting a plan sets `scheduled_date = today` on the chosen tasks (lifecycle → Scheduled).

**Interaction with Inbox.** Planning is the natural triage moment. The flow surfaces unprocessed Inbox items and invites the user to pull relevant ones into today or process them into Planned. It *nudges* toward Inbox-zero but never forces it; nothing is silently lost.

**When a plan already exists** (e.g., prepared during yesterday's End-of-Day, or accepted earlier today). The workflow is **idempotent — it never clobbers commitments.** Instead of re-proposing from scratch, it shows a lighter *"Here's your plan — still good?"* confirmation and highlights only what **changed overnight**: new overdue items, meetings added/cancelled, tasks that became blocked or unblocked, recurring instances that regenerated. The user confirms or adjusts. Proposal only *fills gaps*; it never overwrites intent.

**Relationship to Current Focus.** Planning sets the menu; **Current Focus (§8) picks the next bite** from it. Accepting a plan immediately gives Current Focus a well-formed set to choose from.

---

## 7. Page Layout

**Structure — a dominant "work column" with a sticky "time companion."** On wide screens (≥ xl) the **Timeline** is a sticky left rail (reference, stable) beside the work column (action, ever-changing); below xl it collapses to a single reading order. You never scroll away from "when's my next meeting?" while working.

**Work-column order (top = most important):**
1. **Day header + glance line** *(thin, quiet)* — greeting, date, one-line snapshot (meetings · tasks due · next-event countdown), reusing the Overview's "at a glance" pattern.
2. **Current Focus** *(hero — dominant).*
3. **Today's work** *(the committed + stretch buckets — large).*
4. **Waiting / Blocked** *(medium, collapsible, muted).*
5. **Completed Today** *(light, collapsed).*

The **Timeline** rail runs beside 2–4 on desktop; on mobile it sits directly under Current Focus. **Quick Capture** is a persistent affordance, not a section.

**Hierarchy & spacing.** Exactly **one hero** — if everything shouts, nothing does. **Contrast encodes priority** (Focus high-contrast; working set normal; Blocked/Completed muted). **Generous rhythm between zones, density within lists.** **Progressive disclosure** — Blocked and Completed collapsed by default, so the resting state is *only what to do*.

---

## 8. Current Focus (the hero)

Always resolves to **exactly one** thing: a task to work on, a meeting to prepare for, or a calm caught-up state. Its entire value is that *the user does not choose.*

**Anatomy:** the chosen **task** (title, project/client, effort when known); a **"why this" rationale chip** (the single strongest reason — *"Due today · high priority · nothing blocking"* / *"Overdue 2 days"*) so the recommendation is trusted, not black-box; **primary action Start**, secondary **Complete / Defer / Reassign / Open**; and an **override** — *"Not this → show the next option."* Overriding is first-class.

**Meeting-adjacent flip.** When a meeting starts within ~15 min, Current Focus becomes *"Prepare for [meeting]"* (agenda, attendees, Join Meet) — because the genuine next action *is* the meeting. It flips back afterward.

**Eventual scoring (design intent only).** A **pluggable ranker** over: overdue severity, due proximity, priority, blocked-ineligibility, meeting adjacency, effort vs. time remaining, dependency-readiness (prefer unblockers), staleness, and momentum (keep a started task in focus). It may **start deterministic** (overdue → due-today → priority → smallest fitting effort) and later be swapped for a smarter/AI ranker **without touching the UI** — Current Focus is a *strategy interface*.

---

## 9. Task Sections — the working set

**Model: group by _actionability / commitment_, not by project, raw priority, or energy.**

- *By project* scatters urgency; *by raw priority* ignores blocked/faraway; *by time* is the Timeline's job; *by energy* is subjective and premature. *By commitment* matches how execution feels.

**Structure — three buckets, overdue pinned:**
1. **⚠ Overdue** *(pinned, urgent)* — committed but missed; must be consciously re-committed or deferred, never silently rolled.
2. **Must do today** *(the committed set)* — the finite list the realistic-completion math measures against. Populated by Morning Planning; equals *Scheduled-today + Overdue* in lifecycle terms.
3. **Could do / stretch** *(lighter)* — available if time allows; lets the user overshoot-plan safely and see core vs. bonus at a glance.

Rows are compact (title, project/client, priority dot, effort, due/blocked chips) with inline **Complete / Start / Defer**. A **secondary user toggle** can re-group the same set by project or priority; energy-level is a documented future lens. The default is always the low-decision actionability view.

---

## 10. Meetings on Today

**Meetings live on the Timeline, plus a header signal and the Current-Focus prep flip — no standalone meetings list.** Meetings are time-bound, so their home is the time axis; a second list would duplicate the Calendar and add exactly the scanning this page removes. The two non-timeline touchpoints earn their place because they're *action, not browsing*: the header countdown (orientation) and the Focus flip (the imminent meeting genuinely is the next action). **Timeline = see in context · Current Focus = act · Calendar = manage.**

*Dependency to resolve:* "my meetings today" = meetings where I'm **owner (`created_by`) or an attendee**; attendees are emails, so this needs identity resolution to the signed-in admin (flagged in §16).

---

## 11. Today's Timeline

A single vertical **time axis** for the working day (`Africa/Johannesburg`) with a live **"now" line** — the page's sense of *when*.

**Layers:** **Meetings** (hard, immovable anchors from the Meetings domain) · **Focus blocks** (soft, fillable working windows, user- or system-suggested) · **Time-anchored tasks** (only tasks with a genuine time) · **Reminders** (points).

**Coexistence rules.** Meetings are authoritative; focus blocks flow around them. **Untimed tasks never appear on the timeline** — forcing a time creates false precision; they stay in the Task Sections. The timeline can *invite* scheduling: an empty gap offers *"schedule a task here,"* turning a due-today task into a focus block — the bridge between *what* (tasks) and *when* (time) without conflating them.

---

## 12. Waiting / Blocked Work

A distinct, muted, collapsible section surfacing tasks in the **Waiting** state (§3). Blocked work is **removed from the execution path but kept visible and accountable** — excluded from Current Focus and realistic-completion math, because unworkable work must not compete for attention or distort capacity.

Each row shows **what it waits on** (a person — links to Team View — or a thing: client/approval/assets/dependency), **since when** (aging indicator that visibly nags), and a **nudge** (follow up / reassign). On **unblock** it auto-returns to its prior actionable state and becomes Focus-eligible. A blocked task can still be **Overdue**, framed as *"overdue because blocked."* The End-of-Day Review explicitly asks whether any blocked item needs a nudge before leaving.

---

## 13. Quick Capture

A **zero-friction, always-available write path** whose only job is to get a thought out of the user's head without breaking their current task.

**Global shortcut** opens a minimal field from anywhere; type a title, Enter, done, back exactly where you were. **Default destination is the Inbox, unprocessed — never Today**; this is the rule that keeps Today curated. An optional *"add to today"* modifier exists for the rare true-today item, but Inbox is the safe default. **Relationship to Inbox:** capture is the *front door*, Inbox is the *sorting room*; triage happens during Morning Planning or in Inbox, then flows into Planned/Scheduled. Capturing and processing are deliberately separate so neither interrupts the other. *(Future: natural-language parsing at capture time.)*

---

## 14. End-of-Day Review

The intentional close of the day — the user should leave **confident that nothing important was forgotten.**

**Concept:**

> **Day review** — Completed **6** · Moved to tomorrow **2** · Blocked **1** · Still open **3**
> *Anything else to capture?* ______________
> **[ Finish day ]**

**When it appears.** Proactively near the end of the working day (approaching the configured end time), when the user clicks **"Finish day,"** or when the last committed item resolves. A gentle prompt, never a hard interrupt. Once per working day; re-openable, but it doesn't nag.

**Unfinished tasks — explicit, assisted rollover (never silent).** For each still-open committed item, offer: **move to tomorrow** (suggested default), **reschedule to a specific day**, **return to backlog** (Planned, undated), or **drop** (Archived/cancelled). *"Move all remaining to tomorrow"* is a one-click bulk option — but a *choice*, not automation. **Rollover moves the plan/scheduled date, not the due date:** an unfinished item due today becomes **Overdue** and stays red tomorrow — the review never launders a missed deadline.

**Automatic-rollover fallback.** If the user skips the review, unfinished *scheduled-today* items are not lost — next morning's planning **resurfaces them** (as Overdue if past due, else carried-over). The design *prefers* the intentional review; an optional setting can auto-carry unfinished items into tomorrow's proposal.

**Blocked work.** The review lists Waiting items and asks whether any need a **nudge before leaving** (follow-up / reassign) — turning passive waiting into a deliberate handoff.

**Recurring tasks.** The review notes recurring items completed today and that **tomorrow's instances will regenerate** (so it's not a surprise); missed recurring instances follow their definition's skip/roll policy (§3.5). The review *surfaces* recurring state; the recurring engine performs regeneration.

**Inbox capture.** *"Anything else to capture?"* is a final sweep into **Inbox** — last thoughts out before disconnecting, consistent with Quick Capture.

**Tomorrow preparation.** The review can roll into a light **preview of tomorrow** — tomorrow's meetings plus the proposed carryover — so the user leaves with tomorrow already half-planned. This directly feeds the *"plan already exists"* branch of Morning Planning (§6), closing the loop between the two workflows.

**When it disappears.** After **Finish day**, Today enters a calm **"day closed"** state (Completed summary + tomorrow preview). Skipping it causes no harm — next morning's planning absorbs the carryover.

---

## 15. Completed Today & Empty States

**Completed Today** *(passive display; the End-of-Day Review is the active counterpart).* Collapsed by default, showing **count + progress against the committed set** (*"6 done · 4 of 7 committed"*) — meaningful accomplishment, not vanity volume. Expanding reveals muted, most-recent-first items with **Undo**. It sits **below** active work so a finished task never pushes pending work down. At day's end it becomes the "here's what you shipped" summary feeding the review.

**Empty states — every section coaches or disappears; the page never looks broken.**
- **Current Focus (nothing pending):** *"You're clear. Nothing needs you right now."* + soft CTA to plan or pull from Inbox — a reward, not an error.
- **Timeline (no meetings):** *"No meetings today — a clear runway for deep work."*
- **Must do today (empty):** *"Nothing committed yet. Pull from My Tasks or your Inbox."* — points to where work comes from.
- **Could do / Waiting / Completed (empty):** hidden (absence isn't a problem) — except Completed shows *"Nothing finished yet — your first win is one click away."*
- **Whole-page cold start:** an onboarding state explaining Today and routing to Quick Capture / My Tasks — never a blank void.

---

# PART III — FORWARD COMPATIBILITY & DELIVERY

## 16. Future Features — designed-in headroom

Each must slot in **without a redesign**:
- **Recurring tasks** — Today renders dated *instances*; no special case (§3.5).
- **Automations** — fire on lifecycle transitions (§3.7); Today just reacts to state.
- **AI recommendations** — swap the Current-Focus ranker (§8); also powers capture parsing and day summaries.
- **Workload balancing** — reuses the same effort + capacity primitives as realistic-completion; one-person math generalises to Team View.
- **Estimated effort** — one optional field feeds realistic-completion, timeline block sizing, and workload at once.
- **Focus mode** — Current Focus's *Start* expands to a single-task view; the component already centres on one task.
- **Time tracking** — *Start/Complete* modelled as lifecycle events now, so timers clip in later.

Through-line: **rich extensible task objects · a pluggable Focus ranker · a layered timeline · a capture→Inbox pipeline.**

## 17. Implementation Dependencies

**Gating (v1):** 1) **Tasks domain deployed & wired** (migration `0027` applied + queries/actions). 2) **Status model incl. Waiting** with reason + `blocked_since`. 3) **Priority model.** 4) **Due vs Scheduled dates finalised** (ideally distinct: due = commitment, scheduled = intent-to-work). 5) **Assignment/ownership** for tasks, and **meeting "mine"** = owner or attendee-email match (identity resolution). 6) **Meetings integration** — ✅ already built. 7) **A first-pass deterministic Current-Focus ranker** (interface > sophistication). 8) **Inbox + Quick Capture write path.** 9) **Morning Planning & End-of-Day** need the committed-set concept (scheduled-today) + rollover actions.

**Fast-follow / later:** effort estimates → workload/capacity → focus-block storage & schedule-into-gap → task dependencies (auto-unblock) → recurring engine → automation hooks → AI ranker / NL capture / time tracking.

**Honesty guardrail (carried from Overview):** build a section only when a real data source backs it. If v1 ships before effort/capacity exist, realistic-completion and effort-based timeline sizing are **omitted, not faked**.

## 18. Success Criteria

**The bar:** open Today and, within ~5 seconds and with **zero deciding**, know *what to do now, what's next, what can wait, what's blocked, and what needs attention before leaving.*

**Qualitative:** orient in < 5s · one obvious next action, always · ≤ 1 click to start real work · blocked never competes yet is never forgotten · a clean, confident end-of-day · a *home*, not a stop.

**Quantitative (once instrumented):** time-to-first-action · Current-Focus accept vs. override rate · committed-set completion rate · Quick Capture adoption · intraday return frequency · **plan-acceptance rate** (Morning Planning) and **review-completion rate** (End-of-Day).

**Anti-goals:** not a backlog (My Tasks), not a calendar (Calendar), not analytics (Overview). Growth toward any of those is failure.

---

## Consistency Review (the §6 pass)

What was reconciled to make this one cohesive document:

- **Unified "Blocked" and "Waiting"** into a single canonical state (§3), so §12's section, the lifecycle, Current-Focus exclusion, and automations all reference *one* concept instead of two loosely-related ones.
- **Resolved the wrap-up duplication.** The old journey mentioned "wrap-up," and Completed Today implied one. Now **End-of-Day Review (§14) is the single active workflow**; **Completed Today (§15) is its passive display**; the journey (§5) just points to both. No concept is described twice.
- **Made rollover non-contradictory with the honesty guardrail.** Explicit assisted rollover moves the *plan* date only; **Overdue (a derived flag, not a state) never clears on reschedule** — so "move to tomorrow" and "still overdue" coexist truthfully across §3, §12, and §14.
- **Closed the planning loop.** End-of-Day's "prepare tomorrow" (§14) now feeds directly into Morning Planning's *"plan already exists"* branch (§6) — the two workflows are one continuous cycle, not independent features.
- **Tied "Must do today" to the lifecycle.** The committed set (§9) is defined as *Scheduled-today + Overdue*, populated by Morning Planning, measured by realistic-completion, and reviewed at End-of-Day — one thread through four sections.
- **Elevated "lens, not a store"** from a single sentence to the governing P1–P5 (§1), and checked every page description against it and against One-Question (§2) — e.g., Today's "no meetings-management" restraint is now explicitly the principle in action, not an arbitrary choice.
- **Simplified** by deleting menu-style option lists where a recommendation was requested (task grouping, meetings placement) — each now states the decision and the reasoning, reading like a design doc rather than an evaluation.

No unresolved contradictions remain. The document is internally consistent and serves as the execution-side source of truth.
