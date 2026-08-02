-- ============================================================================
-- Bbettr OS — Planner Tasks: CORE tasks table (B4, migration 0037).
--
-- The Task aggregate root (see docs/planner/schema-and-migration-spec.md §4–§6,
-- §16–§19; persistence-architecture.md §1, §15–§17). This migration establishes
-- the STRUCTURAL integrity of the aggregate only:
--   * public.tasks (all approved columns)
--   * composite uniqueness (workspace_id, id) — the anchor for every composite FK
--   * all approved CHECK constraints (incl. the consolidated completion/archive)
--   * all approved FKs + the composite self-FK for parent_id
--   * a LIGHTWEIGHT audit trigger (updated_at + immutable-field preservation)
--   * a DEFENSIVE subtask guard trigger (one-level hierarchy + parent-completion)
--   * read-only RLS (writes only via the future internal op / service role)
--   * grants + core indexes
--
-- OUT OF SCOPE (built by later migrations): blockers (0038), dependencies (0039),
-- labels (0040), recurring_definitions + the recurrence FK/unique (0041),
-- reminders (0042), events (0043), redactions (0044), command_receipts (0045),
-- the internal atomic persistence operation (0046), safe read models (0047).
--
-- The recurrence_definition_id + occurrence_slot COLUMNS and their pairing CHECK
-- ship here; their FK and unique index are deferred to 0041 (target absent now).
--
-- Lifecycle legality lives in the TypeScript state machine + the internal
-- persistence operation (0046). NO lifecycle/ownership/waiting/dependency logic,
-- actor stamping, versioning, timestamp derivation, or event generation lives in
-- these triggers — they are mechanical/structural backstops only.
--
-- NUMBERING: 0037. Prereq: 0036 (workspaces, current_workspace_id()).
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id                       uuid not null default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces (id),

  title                    text not null,
  description              text,

  status                   text not null default 'inbox',

  created_by               uuid not null references public.profiles (id),
  owner_user_id            uuid references public.profiles (id),
  assignee_id              uuid references public.profiles (id),

  priority                 text not null default 'normal',
  critical_reason          text,
  estimated_minutes        integer,

  scheduled_date           date,
  due_date                 date,

  started_at               timestamptz,
  completed_at             timestamptz,
  completed_by             uuid references public.profiles (id),
  archived_at              timestamptz,
  archive_reason           text,

  blocked_since            timestamptz,
  resume_target            text,

  aggregate_version        integer not null default 0,

  parent_id                uuid,
  client_id                uuid references public.clients (id),
  recurrence_definition_id uuid,                 -- FK added in 0041 (target absent now)
  occurrence_slot          text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,          -- exceptional erasure only (never Drop/Cancel)

  constraint tasks_pkey primary key (id),

  -- Anchor for composite FKs (self parent_id here; satellites in 0038+).
  constraint tasks_workspace_id_unique unique (workspace_id, id),

  -- Composite self-FK: a subtask's parent must live in the SAME workspace.
  constraint tasks_parent_fk
    foreign key (workspace_id, parent_id)
    references public.tasks (workspace_id, id),

  -- ── Structural value domains ─────────────────────────────────────────────
  constraint tasks_title_nonempty
    check (char_length(trim(title)) > 0),
  constraint tasks_status_valid
    check (status in ('inbox','planned','scheduled','in_progress','waiting','completed','archived')),
  constraint tasks_priority_valid
    check (priority in ('critical','high','normal','low')),
  constraint tasks_estimated_minutes_positive
    check (estimated_minutes is null or estimated_minutes > 0),
  constraint tasks_resume_target_valid
    check (resume_target is null or resume_target in ('planned','scheduled')),
  constraint tasks_parent_not_self
    check (parent_id is null or parent_id <> id),
  constraint tasks_occurrence_pairing
    check ((recurrence_definition_id is null) = (occurrence_slot is null)),

  -- ── Invariants that must hold regardless of the writer ───────────────────
  constraint tasks_owner_beyond_inbox
    check (status = 'inbox' or owner_user_id is not null),
  constraint tasks_assignee_for_in_progress
    check (status <> 'in_progress' or assignee_id is not null),
  constraint tasks_critical_reason_iff_critical
    check ((priority = 'critical') = (critical_reason is not null)),
  constraint tasks_waiting_consistency
    check ((status = 'waiting') = (blocked_since is not null and resume_target is not null)),

  -- ── Consolidated completion / archive metadata (5 exhaustive cases) ──────
  -- completed             → completion set, archive null
  -- archived + retention  → completion RETAINED (reportable), archived_at set
  -- archived + cancelled  → completion null (not falsely completed), archived_at set
  -- any active state      → completion + archive all null
  -- NB: `is not distinct from` (not `=`) so a NULL archive_reason yields FALSE,
  -- not NULL — otherwise the disjunction would be NULL and a CHECK treats NULL
  -- as passing, wrongly accepting an archived row with no reason.
  constraint tasks_completion_archive_consistency check (
    (status = 'completed'
       and completed_at is not null and completed_by is not null
       and archived_at is null and archive_reason is null)
    or
    (status = 'archived' and archive_reason is not distinct from 'retention'
       and completed_at is not null and completed_by is not null
       and archived_at is not null)
    or
    (status = 'archived' and archive_reason is not distinct from 'cancelled'
       and archived_at is not null
       and completed_at is null and completed_by is null)
    or
    (status in ('inbox','planned','scheduled','in_progress','waiting')
       and completed_at is null and completed_by is null
       and archived_at is null and archive_reason is null)
  )
);

comment on table public.tasks is
  'Task aggregate root (internal admin-only). Read-only via RLS; all writes flow '
  'through the internal atomic persistence operation (0046). Lifecycle legality '
  'lives in the TypeScript state machine, not in triggers.';

-- ── Lightweight audit trigger — mechanical only ─────────────────────────────
-- SECURITY INVOKER. On UPDATE: advance updated_at and hold the immutable fields
-- to their OLD values. It NEVER stamps actor info (created_by comes from the op's
-- trusted actor), never derives lifecycle timestamps, never touches versions.
create or replace function public.tasks_enforce_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.id           := old.id;            -- immutable
    new.workspace_id := old.workspace_id;  -- immutable
    new.created_at   := old.created_at;    -- immutable
    new.created_by   := old.created_by;    -- immutable
    new.updated_at   := now();
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_enforce_audit on public.tasks;
create trigger tasks_enforce_audit
  before insert or update on public.tasks
  for each row
  execute function public.tasks_enforce_audit();

-- ── Defensive subtask guard trigger — structural backstop only ──────────────
-- Enforces, regardless of the writer:
--   (1) one-level hierarchy: a task that has a parent may not itself be a parent,
--       and a task that has children may not be given a parent;
--   (2) parent-completion block: a parent cannot become 'completed' while an
--       active (non-completed/non-archived, live) child exists.
-- It contains NO lifecycle, ownership, waiting, dependency, timestamp, or event
-- logic — only the two approved structural rules.
create or replace function public.tasks_subtask_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- (1a) If this row has a parent, that parent must not itself have a parent.
  if new.parent_id is not null then
    if exists (
      select 1 from public.tasks p
      where p.id = new.parent_id and p.parent_id is not null
    ) then
      raise exception 'OneLevelHierarchy: parent % already has a parent; only one nesting level is allowed', new.parent_id
        using errcode = 'BB371';
    end if;
  end if;

  -- (1b) If this row is (or becomes) a parent, it must not itself have a parent.
  if new.parent_id is not null then
    if exists (select 1 from public.tasks ch where ch.parent_id = new.id) then
      raise exception 'OneLevelHierarchy: task % has children and cannot be given a parent', new.id
        using errcode = 'BB371';
    end if;
  end if;

  -- (2) Parent-completion block: cannot complete a parent with an active child.
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if exists (
      select 1 from public.tasks ch
      where ch.parent_id = new.id
        and ch.deleted_at is null
        and ch.status not in ('completed','archived')
    ) then
      raise exception 'ActiveChildren: task % has active child tasks and cannot be completed', new.id
        using errcode = 'BB372';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_subtask_guard on public.tasks;
create trigger tasks_subtask_guard
  before insert or update on public.tasks
  for each row
  execute function public.tasks_subtask_guard();

-- ── Row Level Security — ADMIN + WORKSPACE, READ-ONLY ───────────────────────
alter table public.tasks enable row level security;
alter table public.tasks force row level security;

-- SELECT: admin, own workspace, live rows only. is_admin() and the workspace
-- match are SEPARATE conjuncts; clients/reps get zero rows.
drop policy if exists tasks_select_admin on public.tasks;
create policy tasks_select_admin
  on public.tasks
  for select
  to authenticated
  using (
    public.is_admin()
    and workspace_id = public.current_workspace_id()
    and deleted_at is null
  );

-- No INSERT/UPDATE/DELETE policies → every authenticated write is denied. All
-- writes flow through the internal atomic persistence operation (0046, running
-- as service_role, which bypasses RLS). Browser writes are forbidden.

-- ── Privileges — least privilege; RLS is the SELECT gate ────────────────────
grant select on public.tasks to authenticated;
grant all    on public.tasks to service_role;
revoke all   on public.tasks from anon;

-- ── Core indexes (partial on live rows) ─────────────────────────────────────
create index if not exists tasks_today_idx
  on public.tasks (workspace_id, assignee_id, scheduled_date)
  where deleted_at is null and status in ('scheduled','in_progress','waiting');
create index if not exists tasks_due_idx
  on public.tasks (workspace_id, due_date)
  where deleted_at is null and status not in ('completed','archived') and due_date is not null;
create index if not exists tasks_my_tasks_idx
  on public.tasks (workspace_id, assignee_id, status) where deleted_at is null;
create index if not exists tasks_inbox_idx
  on public.tasks (workspace_id) where status = 'inbox' and deleted_at is null;
create index if not exists tasks_team_view_idx
  on public.tasks (workspace_id, owner_user_id, status) where deleted_at is null;
create index if not exists tasks_client_idx
  on public.tasks (workspace_id, client_id) where client_id is not null and deleted_at is null;
create index if not exists tasks_parent_idx
  on public.tasks (parent_id) where deleted_at is null;
