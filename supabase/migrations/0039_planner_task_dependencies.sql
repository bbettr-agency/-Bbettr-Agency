-- ============================================================================
-- Bbettr OS — Planner Tasks: task_dependencies (B4, migration 0039).
--
-- Directed dependency edges between tasks (see schema-and-migration-spec.md §8,
-- persistence-architecture.md §8, task-domain-architecture.md §8). Hard edges
-- block; informational edges are advisory. Edges are immutable-history: identity
-- never changes; only the lifecycle columns (resolved_at / removed_at /
-- removal_reason) move, and a resolved/removed relationship may be re-added as a
-- new row.
--
-- STRICT SCOPE — this migration stores dependency EDGES only. It creates the
-- table, its CHECKs/FKs, the active-only unique index, a silent-hold
-- immutability trigger, a defensive cycle-guard trigger, read-only RLS, grants,
-- and two traversal indexes. It NEVER creates/resolves task_blockers, changes
-- task state or tasks.blocked_since, adds triggers to public.tasks or
-- public.task_blockers, emits events, or handles semantic idempotent retries —
-- all of that is the persistence op (0046). It does not modify 0038.
--
-- NUMBERING: 0039. Prereq: 0037 (tasks + the (workspace_id,id) composite anchor).
-- ============================================================================

create table if not exists public.task_dependencies (
  id              uuid not null default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  dependent_id    uuid not null,     -- the task that waits
  prerequisite_id uuid not null,     -- the task it waits for

  kind            text not null,
  resolved_at     timestamptz,       -- set when the prerequisite completes/archives (op)
  removed_at      timestamptz,       -- set on manual removal (op)
  removal_reason  text,
  created_at      timestamptz not null default now(),

  constraint task_dependencies_pkey primary key (id),

  -- Same-workspace enforcement for BOTH endpoints (both NOT NULL → always checked).
  constraint task_dependencies_dependent_fk
    foreign key (workspace_id, dependent_id)
    references public.tasks (workspace_id, id),
  constraint task_dependencies_prerequisite_fk
    foreign key (workspace_id, prerequisite_id)
    references public.tasks (workspace_id, id),

  -- Value domain + self-dependency prevention (both NOT NULL → fully boolean).
  constraint task_dependencies_kind_valid
    check (kind in ('hard','info')),
  constraint task_dependencies_no_self
    check (dependent_id <> prerequisite_id),

  -- Dependency-state consistency. Fully null-safe: every clause is `is [not] null`
  -- or a non-empty test, so the expression is only ever TRUE or FALSE. The three
  -- valid states are ACTIVE / RESOLVED / REMOVED; everything else is rejected.
  constraint task_dependencies_state_consistency check (
    -- ACTIVE
    (resolved_at is null and removed_at is null and removal_reason is null)
    or
    -- RESOLVED
    (resolved_at is not null and removed_at is null and removal_reason is null)
    or
    -- REMOVED (requires a meaningful removal_reason)
    (resolved_at is null and removed_at is not null
       and removal_reason is not null and char_length(trim(removal_reason)) > 0)
  )
);

comment on table public.task_dependencies is
  'Directed task dependency edges (internal admin-only). Immutable-history: '
  'identity is fixed; only resolved_at/removed_at/removal_reason move; re-adds '
  'are new rows. Read-only via RLS; writes flow through the internal op (0046). '
  'Stores edges ONLY — blocker coupling and task-state changes are the op''s job.';

-- ── Active-only uniqueness: one active edge per (dependent, prerequisite, kind) ─
-- A resolved/removed relationship is retained and the same relationship may be
-- re-added later as a new-identity row.
create unique index if not exists task_dependencies_active_edge_idx
  on public.task_dependencies (dependent_id, prerequisite_id, kind)
  where resolved_at is null and removed_at is null;

-- ── Immutability trigger — silent-hold (0037/0038 convention) ────────────────
-- Only resolved_at / removed_at / removal_reason may change; identity fields are
-- silently restored to OLD on UPDATE.
create or replace function public.task_dependencies_enforce_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.workspace_id    := old.workspace_id;
    new.dependent_id    := old.dependent_id;
    new.prerequisite_id := old.prerequisite_id;
    new.kind            := old.kind;
    new.created_at      := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists task_dependencies_enforce_immutable on public.task_dependencies;
create trigger task_dependencies_enforce_immutable
  before update on public.task_dependencies
  for each row
  execute function public.task_dependencies_enforce_immutable();

-- ── Defensive cycle-guard trigger ───────────────────────────────────────────
-- Rejects an active HARD edge that would close a cycle among the active-hard,
-- same-workspace graph. Trigger-order-safe: edge IDENTITY is read from OLD on
-- UPDATE (so an attempted identity change cannot influence the check, regardless
-- of whether the immutability trigger has run yet), while LIFECYCLE state
-- (resolved_at/removed_at) is read from the attempted NEW values. On INSERT,
-- OLD is null so identity comes from NEW. The traversal considers only active
-- hard edges in the same workspace, excludes this row's own id, and dedupes via
-- a recursive CTE UNION so it terminates even on malformed historical cycles.
create or replace function public.task_dependencies_cycle_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace    uuid;
  v_dependent    uuid;
  v_prerequisite uuid;
  v_kind         text;
  v_self_id      uuid;
  v_cycle        boolean;
begin
  -- Immutable identity: from OLD on UPDATE, from NEW on INSERT.
  if tg_op = 'UPDATE' then
    v_workspace    := old.workspace_id;
    v_dependent    := old.dependent_id;
    v_prerequisite := old.prerequisite_id;
    v_kind         := old.kind;
    v_self_id      := old.id;
  else
    v_workspace    := new.workspace_id;
    v_dependent    := new.dependent_id;
    v_prerequisite := new.prerequisite_id;
    v_kind         := new.kind;
    v_self_id      := new.id;
  end if;

  -- Only guard when the EFFECTIVE resulting edge is active + hard.
  if v_kind <> 'hard' or new.resolved_at is not null or new.removed_at is not null then
    return new;
  end if;

  -- Would adding (dependent -> prerequisite) close a cycle? It does iff the
  -- prerequisite already transitively depends on the dependent via active hard
  -- edges. Walk depends-on edges (dependent_id = current node → prerequisite_id)
  -- starting from v_prerequisite; if we reach v_dependent, it is a cycle.
  with recursive reach(node) as (
    select d.prerequisite_id
      from public.task_dependencies d
     where d.dependent_id = v_prerequisite
       and d.workspace_id = v_workspace
       and d.kind = 'hard'
       and d.resolved_at is null and d.removed_at is null
       and d.id <> v_self_id
    union
    select d.prerequisite_id
      from public.task_dependencies d
      join reach r on d.dependent_id = r.node
     where d.workspace_id = v_workspace
       and d.kind = 'hard'
       and d.resolved_at is null and d.removed_at is null
       and d.id <> v_self_id
  )
  select exists (select 1 from reach where node = v_dependent) into v_cycle;

  if v_cycle then
    raise exception 'DependencyCycle: a hard dependency from % to % would close a cycle',
      v_dependent, v_prerequisite
      using errcode = 'BB390';
  end if;

  return new;
end;
$$;

drop trigger if exists task_dependencies_cycle_guard on public.task_dependencies;
create trigger task_dependencies_cycle_guard
  before insert or update on public.task_dependencies
  for each row
  execute function public.task_dependencies_cycle_guard();

-- ── Row Level Security — ADMIN + WORKSPACE, READ-ONLY ───────────────────────
-- No deleted_at column (rows are retained), so the policy is is_admin() AND
-- workspace, with no deleted_at clause.
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;

drop policy if exists task_dependencies_select_admin on public.task_dependencies;
create policy task_dependencies_select_admin
  on public.task_dependencies
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- No INSERT/UPDATE/DELETE policies → authenticated writes denied. Writes flow
-- through the internal atomic persistence operation (0046, service_role).

grant select on public.task_dependencies to authenticated;
grant all    on public.task_dependencies to service_role;
revoke all   on public.task_dependencies from anon;

-- ── Traversal indexes (partial on active edges) ─────────────────────────────
create index if not exists task_dependencies_prereq_active_idx
  on public.task_dependencies (prerequisite_id)
  where resolved_at is null and removed_at is null;
create index if not exists task_dependencies_dependent_active_idx
  on public.task_dependencies (dependent_id)
  where resolved_at is null and removed_at is null;
