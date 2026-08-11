-- ============================================================================
-- Bbettr OS — Planner Weekly Updates: manual updates (migration 0051).
--
-- Weekly Updates answers "what did we actually get done this week?". Completed
-- Planner tasks feed it AUTOMATICALLY from the tasks table (no storage here);
-- this migration adds ONLY the small table for MANUAL updates — work done off the
-- Planner that would otherwise require a fake task. A manual update is NOT a task
-- (no lifecycle, no events); it is a simple admin+workspace CRUD row.
--
-- Attribution + authorization: author_user_id is the admin credited AND the sole
-- deleter. The server derives workspace_id (current_workspace_id) and
-- author_user_id (auth.uid()) — the browser supplies only summary/client/date —
-- and the RLS WITH CHECK / USING clauses are the backstop: no cross-workspace
-- insert, no author spoofing, and no admin can delete another admin's update.
-- Clients/reps/anon have zero access. Simple authenticated writes (no service-role
-- op) — this is not a task-domain aggregate.
--
-- NUMBERING: 0051. Prereq: 0001 (profiles, is_admin), 0036 (workspaces,
-- current_workspace_id), clients (0001). Does NOT touch tasks, RLS elsewhere,
-- 0049/0050, or any other table.
-- ============================================================================

create table if not exists public.weekly_updates (
  id             uuid not null default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id),
  author_user_id uuid not null references public.profiles (id),

  summary        text not null,
  client_id      uuid references public.clients (id),   -- nullable → Internal / No client
  update_date    date not null,                         -- agency-local day the work was done

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint weekly_updates_pkey primary key (id),
  -- Summary is bounded, non-empty (trimmed 1..500) — a note, not a document.
  constraint weekly_updates_summary_len
    check (char_length(trim(summary)) between 1 and 500)
);

comment on table public.weekly_updates is
  'Manual Weekly Updates — off-Planner work credited to author_user_id (internal '
  'admin-only). Completed tasks feed Weekly Updates automatically from tasks; this '
  'stores ONLY manual entries. Not a task. Author-scoped writes; RLS admin+workspace.';

-- Mechanical audit trigger (mirrors the tasks/recurring pattern): advance
-- updated_at; hold id/workspace_id/author_user_id/created_at immutable. No actor
-- stamping. (v1 exposes no UPDATE path; this future-proofs an edit feature.)
create or replace function public.weekly_updates_enforce_audit()
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
    new.id             := old.id;
    new.workspace_id   := old.workspace_id;
    new.author_user_id := old.author_user_id;
    new.created_at     := old.created_at;
    new.updated_at     := now();
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_updates_enforce_audit on public.weekly_updates;
create trigger weekly_updates_enforce_audit
  before insert or update on public.weekly_updates
  for each row
  execute function public.weekly_updates_enforce_audit();

-- The weekly read work queue: workspace's updates within a date range.
create index if not exists weekly_updates_workspace_date_idx
  on public.weekly_updates (workspace_id, update_date);

-- ── Row Level Security — ADMIN + WORKSPACE; author-scoped writes ─────────────
alter table public.weekly_updates enable row level security;
alter table public.weekly_updates force row level security;

-- SELECT: any admin may read every update in THEIR workspace (transparency).
drop policy if exists weekly_updates_select_admin on public.weekly_updates;
create policy weekly_updates_select_admin
  on public.weekly_updates
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- INSERT: admin, own workspace, authored by SELF (no cross-workspace / author spoof).
drop policy if exists weekly_updates_insert_admin on public.weekly_updates;
create policy weekly_updates_insert_admin
  on public.weekly_updates
  for insert
  to authenticated
  with check (
    public.is_admin()
    and workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
  );

-- DELETE: only the author may delete their own update (another admin cannot).
drop policy if exists weekly_updates_delete_admin on public.weekly_updates;
create policy weekly_updates_delete_admin
  on public.weekly_updates
  for delete
  to authenticated
  using (
    public.is_admin()
    and workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
  );

-- No UPDATE policy → edits are denied for everyone (v1: delete + re-add).

-- ── Privileges — least privilege ────────────────────────────────────────────
grant select, insert, delete on public.weekly_updates to authenticated;
grant all    on public.weekly_updates to service_role;
revoke all   on public.weekly_updates from anon;

-- ── Rollback (manual) ────────────────────────────────────────────────────────
--   drop table if exists public.weekly_updates cascade;
--   drop function if exists public.weekly_updates_enforce_audit();
