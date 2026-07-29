-- ============================================================================
-- Bbettr OS — Planner tasks (internal, ADMIN-ONLY).
--
-- Ported from the standalone Planner's 0002_tasks, adapted to the Portal's
-- identity model: "approved member" → an ADMIN profile (role = 'admin'). Tasks
-- reference the Portal's existing public.profiles; the audit trigger stamps
-- created_by/completed_by from auth.uid() and is non-spoofable.
--
-- Additive and isolated: two new enums + one table + one trigger + indexes +
-- RLS. Touches NOTHING existing — no changes to profiles, clients, billing,
-- onboarding, or any Portal table. Clients and reps (is_admin() = false) get
-- ZERO access at the RLS layer; the module is also behind the (admin) route
-- group and the PLANNER_ENABLED flag.
--
-- NUMBERING: 0027.
-- ============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('todo', 'in_progress', 'completed');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('normal', 'high', 'urgent');
  end if;
end
$$;

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),

  title             text not null check (char_length(trim(title)) > 0),
  notes             text,
  client_or_project text,                                  -- free-text (future: may reference clients)

  assignee_id       uuid not null references public.profiles (id),
  scheduled_date    date,                                  -- null = Inbox
  status            public.task_status   not null default 'todo',
  priority          public.task_priority not null default 'normal',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),

  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_by      uuid references public.profiles (id),
  completed_at      timestamptz,

  deleted_at        timestamptz,                           -- soft delete / archive

  constraint tasks_completion_consistency check (
    (status =  'completed' and completed_at is not null and completed_by is not null) or
    (status <> 'completed' and completed_at is null     and completed_by is null)
  )
);

comment on table public.tasks is
  'Planner tasks (internal admin-only). scheduled_date NULL = Inbox. Audit fields are server-stamped and non-spoofable.';

-- ── Server-controlled audit + completion trigger (anti-spoofing) ─────────────
-- Runs as the invoking user so auth.uid() is the authenticated actor.
create or replace function public.tasks_enforce_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();          -- ignore any client value
    new.created_at := now();
    new.updated_at := now();
    if new.status = 'completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;

  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;       -- immutable
    new.created_at := old.created_at;       -- immutable
    new.updated_at := now();

    if new.status = 'completed' and old.status is distinct from 'completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    elsif new.status <> 'completed' then
      new.completed_at := null;
      new.completed_by := null;
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_enforce_audit on public.tasks;
create trigger tasks_enforce_audit
  before insert or update on public.tasks
  for each row
  execute function public.tasks_enforce_audit();

-- ── Indexes (partial on live rows) ──────────────────────────────────────────
create index if not exists tasks_assignee_idx
  on public.tasks (assignee_id) where deleted_at is null;
create index if not exists tasks_scheduled_date_idx
  on public.tasks (scheduled_date) where deleted_at is null;
create index if not exists tasks_status_idx
  on public.tasks (status) where deleted_at is null;
create index if not exists tasks_assignee_status_idx
  on public.tasks (assignee_id, status) where deleted_at is null;

-- ── Row Level Security — ADMIN-ONLY ─────────────────────────────────────────
alter table public.tasks enable row level security;
alter table public.tasks force row level security;

-- Read: admins see all non-deleted tasks. Clients/reps (is_admin() = false) see none.
drop policy if exists tasks_select_admin on public.tasks;
create policy tasks_select_admin
  on public.tasks
  for select
  to authenticated
  using (public.is_admin() and deleted_at is null);

-- Insert: admin only; created_by pinned to self (trigger also enforces it);
-- assignee must be an admin profile.
drop policy if exists tasks_insert_admin on public.tasks;
create policy tasks_insert_admin
  on public.tasks
  for insert
  to authenticated
  with check (
    public.is_admin()
    and created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = assignee_id and p.role = 'admin'
    )
  );

-- Update: admin only; assignee must remain an admin. Soft delete is an UPDATE.
drop policy if exists tasks_update_admin on public.tasks;
create policy tasks_update_admin
  on public.tasks
  for update
  to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = assignee_id and p.role = 'admin'
    )
  );

-- No DELETE policy → hard deletes denied; deletion is soft (deleted_at).

-- ── Privileges — let RLS be the gate for authenticated; anon gets nothing. ──
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.tasks from anon;
