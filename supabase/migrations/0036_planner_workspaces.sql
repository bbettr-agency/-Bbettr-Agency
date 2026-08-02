-- ============================================================================
-- Bbettr OS — Planner Tasks: WORKSPACE foundation (B4, migration 0036).
--
-- The workspace/tenant seam for the new Task Domain (see
-- docs/planner/schema-and-migration-spec.md §3 and
-- docs/planner/persistence-architecture.md §15). Single active workspace today;
-- this migration only lays the seam so future departments / multiple businesses
-- become a partition rather than a rewrite.
--
-- Scope (this migration and NOTHING else):
--   1. public.workspaces table (+ constraints, RLS, grants)
--   2. seed the single agency workspace (deterministic, idempotent)
--   3. profiles.workspace_id column (+ FK + index)
--   4. backfill ONLY role='admin' profiles to the seeded workspace
--   5. public.current_workspace_id() (fail-closed, SECURITY DEFINER)
--
-- It creates NO Tasks table and none of the 0037–0047 objects. Idempotent and
-- safe to rerun. Touches no existing table except the additive profiles column.
--
-- Fixed agency-workspace UUID (referenced by the seed and the admin backfill):
--   00000000-0000-0000-0000-000000000001
--
-- NUMBERING: 0036.
-- ============================================================================

-- ── 1. workspaces table ─────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) > 0),
  slug       text not null unique check (char_length(trim(slug)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Task Domain tenancy boundary. One row per workspace/organization; a single '
  'agency workspace is seeded today. Referenced by profiles.workspace_id and '
  '(future) every task-domain table via a composite FK.';

-- ── 2. Seed the single agency workspace (deterministic + idempotent) ────────
-- Fixed id so the seed is stable across environments and the admin backfill can
-- reference it directly. ON CONFLICT (id) DO NOTHING → never a duplicate row on
-- rerun; the unique slug also blocks a second differently-id'd agency row.
insert into public.workspaces (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Bbettr Agency', 'bbettr-agency')
on conflict (id) do nothing;

-- ── 3. profiles.workspace_id (additive column + FK + index) ─────────────────
-- Nullable: client/rep profiles never get a workspace; a null workspace makes
-- current_workspace_id() fail closed. FK guarantees referential integrity; no
-- ON DELETE action (workspaces are never deleted — see RLS below).
alter table public.profiles
  add column if not exists workspace_id uuid references public.workspaces (id);

create index if not exists profiles_workspace_id_idx
  on public.profiles (workspace_id);

-- ── 4. Backfill ONLY admin profiles to the seeded workspace ─────────────────
-- Idempotent: only fills profiles that are admin AND not already assigned, so a
-- rerun updates nothing. Clients and reps are intentionally left null.
update public.profiles
   set workspace_id = '00000000-0000-0000-0000-000000000001'
 where role = 'admin'
   and workspace_id is null;

-- ── 5. current_workspace_id() — fail-closed workspace resolver ──────────────
-- Same shape as is_admin()/current_client_id(): SECURITY DEFINER + STABLE +
-- explicit search_path. Returns the caller's workspace, or NULL when the caller
-- has no profile or no workspace (fail-closed). Every task-domain RLS policy
-- ANDs `workspace_id = current_workspace_id()`, so a NULL result denies all rows.
create or replace function public.current_workspace_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select workspace_id from profiles where id = auth.uid();
$$;

-- ── 6. Row Level Security on workspaces ─────────────────────────────────────
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;

-- SELECT: an admin may read ONLY their own workspace. is_admin() and the
-- workspace match are SEPARATE conjuncts — a client/rep sharing a workspace id
-- would still be denied by the admin gate. Clients/reps get zero rows.
drop policy if exists workspaces_select_admin on public.workspaces;
create policy workspaces_select_admin
  on public.workspaces
  for select
  to authenticated
  using (public.is_admin() and id = public.current_workspace_id());

-- No INSERT/UPDATE/DELETE policies → all writes are denied for authenticated
-- (browser writes forbidden). Rows are created only by this seed (migration
-- role) or by trusted service-role infrastructure (which bypasses RLS).

-- ── Privileges — least privilege; RLS is the SELECT gate ────────────────────
grant select on public.workspaces to authenticated;
grant all    on public.workspaces to service_role;
revoke all   on public.workspaces from anon;
