-- ============================================================================
-- Bbettr OS — Planner Tasks: task_blockers (B4, migration 0038).
--
-- The DETAIL side of the Waiting model (see schema-and-migration-spec.md §7,
-- persistence-architecture.md §7, task-domain-architecture.md §8). One row per
-- blocker; multiple simultaneous blockers per task across classes. Typed
-- nullable reference columns (NO polymorphic FK); same-workspace composite FKs.
--
-- STRICT SCOPE — this migration creates ONLY the task_blockers table, its
-- constraints, FKs, the active-only unique index, a mechanical immutability
-- trigger, read-only RLS, grants, and two partial indexes.
--
-- OUT OF SCOPE (built later): task_dependencies (0039), auto-blocking /
-- auto-unblocking / blocked_since aggregation / any cross-table lifecycle logic
-- (persistence op, 0046), events (0043), labels (0040), recurrence (0041),
-- reminders (0042), command_receipts (0045), and everything 0039–0047. This
-- migration NEVER modifies public.tasks and NEVER maintains tasks.blocked_since.
--
-- NUMBERING: 0038. Prereq: 0037 (tasks + the (workspace_id,id) composite anchor).
-- ============================================================================

create table if not exists public.task_blockers (
  id                  uuid not null default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id),
  task_id             uuid not null,

  blocker_class       text not null,
  blocker_key         text not null,     -- immutable stable identity (see trigger)

  reference_user_id   uuid references public.profiles (id),   -- set only when class=person
  reference_task_id   uuid,                                   -- set only when class=dependency (composite FK below)
  reference_client_id uuid references public.clients (id),    -- set only when class=client

  reason              text,              -- mutable
  created_at          timestamptz not null default now(),     -- this blocker's "since"
  resolved_at         timestamptz,       -- mutable; null = active

  constraint task_blockers_pkey primary key (id),

  -- Same-workspace enforcement via composite FKs. reference_task_id is nullable:
  -- under MATCH SIMPLE the composite FK is NOT checked when it is NULL, so
  -- non-dependency blockers need no referenced task.
  constraint task_blockers_task_fk
    foreign key (workspace_id, task_id)
    references public.tasks (workspace_id, id),
  constraint task_blockers_reference_task_fk
    foreign key (workspace_id, reference_task_id)
    references public.tasks (workspace_id, id),

  -- Value domains.
  constraint task_blockers_class_valid
    check (blocker_class in ('person','client','approval','asset','dependency')),
  constraint task_blockers_key_nonempty
    check (char_length(trim(blocker_key)) > 0),

  -- Reference-matches-class. Written as an OR of fully-boolean disjuncts
  -- (blocker_class is NOT NULL; every clause is `is [not] null`), so the whole
  -- expression is only ever TRUE or FALSE — never UNKNOWN (which a CHECK would
  -- treat as passing).
  constraint task_blockers_reference_matches_class check (
    (blocker_class = 'person'
       and reference_user_id is not null
       and reference_task_id is null and reference_client_id is null)
    or (blocker_class = 'client'
       and reference_client_id is not null
       and reference_user_id is null and reference_task_id is null)
    or (blocker_class = 'dependency'
       and reference_task_id is not null
       and reference_user_id is null and reference_client_id is null)
    or (blocker_class = 'approval'
       and reference_user_id is null and reference_task_id is null and reference_client_id is null)
    or (blocker_class = 'asset'
       and reference_user_id is null and reference_task_id is null and reference_client_id is null)
  )
);

comment on table public.task_blockers is
  'Detail rows for the Waiting model (internal admin-only). Multiple active '
  'blockers per task; typed nullable references (no polymorphic FK); resolved '
  'rows retained. Read-only via RLS; writes flow through the internal op (0046). '
  'Never maintains tasks.blocked_since (that is the op''s job).';

-- ── Active-only idempotency: one active blocker per (task, class, key) ───────
-- Distinct keys coexist (multiple approvals/assets); a duplicate active retry
-- is a no-op; the same identity may be re-added once the prior is resolved.
create unique index if not exists task_blockers_active_key_idx
  on public.task_blockers (task_id, blocker_class, blocker_key)
  where resolved_at is null;

-- ── Immutability trigger — mechanical silent-hold (0037 convention) ─────────
-- Only `reason` and `resolved_at` may change after creation; every identity /
-- reference field is silently restored to its OLD value on UPDATE. No lifecycle,
-- aggregation, or cross-table logic.
create or replace function public.task_blockers_enforce_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.id                  := old.id;
    new.workspace_id        := old.workspace_id;
    new.task_id             := old.task_id;
    new.blocker_class       := old.blocker_class;
    new.blocker_key         := old.blocker_key;
    new.reference_user_id   := old.reference_user_id;
    new.reference_task_id   := old.reference_task_id;
    new.reference_client_id := old.reference_client_id;
    new.created_at          := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists task_blockers_enforce_immutable on public.task_blockers;
create trigger task_blockers_enforce_immutable
  before update on public.task_blockers
  for each row
  execute function public.task_blockers_enforce_immutable();

-- ── Row Level Security — ADMIN + WORKSPACE, READ-ONLY ───────────────────────
-- No deleted_at column (resolved rows are retained), so the policy is
-- is_admin() AND workspace, with no deleted_at clause.
alter table public.task_blockers enable row level security;
alter table public.task_blockers force row level security;

drop policy if exists task_blockers_select_admin on public.task_blockers;
create policy task_blockers_select_admin
  on public.task_blockers
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- No INSERT/UPDATE/DELETE policies → authenticated writes denied. Writes flow
-- through the internal atomic persistence operation (0046, service_role).

grant select on public.task_blockers to authenticated;
grant all    on public.task_blockers to service_role;
revoke all   on public.task_blockers from anon;

-- ── Indexes (partial on active rows) ────────────────────────────────────────
create index if not exists task_blockers_task_active_idx
  on public.task_blockers (task_id) where resolved_at is null;
create index if not exists task_blockers_ref_task_idx
  on public.task_blockers (reference_task_id)
  where resolved_at is null and blocker_class = 'dependency';
