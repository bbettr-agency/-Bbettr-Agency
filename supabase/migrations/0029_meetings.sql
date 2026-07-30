-- ============================================================================
-- Bbettr OS — Planner meetings (internal, ADMIN-ONLY).
--
-- Phase 3. A meeting is a first-class calendar entity (time window + optional
-- Google Meet). It is the AUTHORITATIVE source of truth; Google Calendar is a
-- one-way projection (see calendar_projections, 0031). A meeting is fully
-- reconstructable from this table + meeting_attendees alone.
--
-- Status vocabulary is intentionally minimal — only states with real behaviour:
--   'scheduled' (default) and 'cancelled'. Meeting completion is NOT implemented
--   in Phase 3, so no 'completed'/'held' state is introduced (no speculative
--   states). Meet-link state lives in calendar_projections, not here.
--
-- Additive and isolated: one table + one audit trigger + indexes + RLS. Touches
-- NOTHING existing. Clients/reps (is_admin() = false) get ZERO access; the module
-- is also behind the (admin) route group and the PLANNER_ENABLED flag.
--
-- NUMBERING: 0029.
-- ============================================================================

create table if not exists public.meetings (
  id            uuid primary key default gen_random_uuid(),

  title         text not null check (char_length(trim(title)) > 0),
  description   text,

  -- Canonical instants (UTC) + the IANA zone the meeting is expressed in. The
  -- projection sends RFC3339 + explicit timeZone so Google handles DST correctly.
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  time_zone     text not null default 'Africa/Johannesburg',

  has_meet      boolean not null default false,

  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'cancelled')),

  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cancelled_by  uuid references public.profiles (id),
  cancelled_at  timestamptz,

  deleted_at    timestamptz,                          -- soft delete / archive

  constraint meetings_time_valid check (ends_at > starts_at),
  constraint meetings_cancel_consistency check (
    (status =  'cancelled' and cancelled_at is not null and cancelled_by is not null) or
    (status <> 'cancelled' and cancelled_at is null     and cancelled_by is null)
  )
);

comment on table public.meetings is
  'Planner meetings (internal admin-only). Authoritative source of truth; Google Calendar is a one-way projection. Audit fields are server-stamped and non-spoofable.';

-- ── Server-controlled audit + cancellation trigger (anti-spoofing) ───────────
-- Runs as the invoking user so auth.uid() is the authenticated actor.
create or replace function public.meetings_enforce_audit()
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
    if new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    else
      new.cancelled_at := null;
      new.cancelled_by := null;
    end if;

  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;       -- immutable
    new.created_at := old.created_at;       -- immutable
    new.updated_at := now();

    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    elsif new.status <> 'cancelled' then
      new.cancelled_at := null;
      new.cancelled_by := null;
    else
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists meetings_enforce_audit on public.meetings;
create trigger meetings_enforce_audit
  before insert or update on public.meetings
  for each row
  execute function public.meetings_enforce_audit();

-- ── Indexes (partial on live rows) ──────────────────────────────────────────
create index if not exists meetings_starts_at_idx
  on public.meetings (starts_at) where deleted_at is null;
create index if not exists meetings_status_idx
  on public.meetings (status) where deleted_at is null;

-- ── Row Level Security — ADMIN-ONLY ─────────────────────────────────────────
alter table public.meetings enable row level security;
alter table public.meetings force row level security;

-- Read: admins see all non-deleted meetings. Clients/reps see none.
drop policy if exists meetings_select_admin on public.meetings;
create policy meetings_select_admin
  on public.meetings
  for select
  to authenticated
  using (public.is_admin() and deleted_at is null);

-- Insert: admin only; created_by pinned to self (trigger also enforces it).
drop policy if exists meetings_insert_admin on public.meetings;
create policy meetings_insert_admin
  on public.meetings
  for insert
  to authenticated
  with check (public.is_admin() and created_by = auth.uid());

-- Update: admin only. Soft delete + cancellation are UPDATEs.
drop policy if exists meetings_update_admin on public.meetings;
create policy meetings_update_admin
  on public.meetings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy → hard deletes denied; deletion is soft (deleted_at).

grant select, insert, update, delete on public.meetings to authenticated;
revoke all on public.meetings from anon;
