-- ============================================================================
-- Bbettr OS — Planner meeting attendees (internal, ADMIN-ONLY).
--
-- Phase 3. Normalized child of public.meetings: the guest list the Portal
-- intends to invite. Part of the meeting's authoritative desired state, so a
-- meeting's Google event is fully reconstructable from meetings + this table.
--
-- Attendees are GUESTS. The connected agency Google account is the event
-- organizer by definition, so there is intentionally NO is_organizer column
-- (it would be a misleading, unused flag). Attendee RSVP state lives in Google
-- and is non-authoritative here.
--
-- Additive and isolated. Admin-only at the RLS layer; anon/clients/reps get zero.
--
-- NUMBERING: 0030.
-- ============================================================================

create table if not exists public.meeting_attendees (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  email        text not null check (char_length(trim(email)) > 0),
  display_name text,
  created_at   timestamptz not null default now()
);

comment on table public.meeting_attendees is
  'Guests for a Planner meeting (admin-only). Organizer is the shared agency Google account, not stored here. RSVP state is non-authoritative and not stored.';

-- One row per (meeting, email); case-insensitive on email.
create unique index if not exists meeting_attendees_unique
  on public.meeting_attendees (meeting_id, lower(email));
create index if not exists meeting_attendees_meeting_idx
  on public.meeting_attendees (meeting_id);

-- ── Row Level Security — ADMIN-ONLY ─────────────────────────────────────────
alter table public.meeting_attendees enable row level security;
alter table public.meeting_attendees force row level security;

drop policy if exists meeting_attendees_select_admin on public.meeting_attendees;
create policy meeting_attendees_select_admin
  on public.meeting_attendees
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists meeting_attendees_insert_admin on public.meeting_attendees;
create policy meeting_attendees_insert_admin
  on public.meeting_attendees
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists meeting_attendees_update_admin on public.meeting_attendees;
create policy meeting_attendees_update_admin
  on public.meeting_attendees
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Attendees are child rows edited by replacement, so DELETE is allowed (admin).
drop policy if exists meeting_attendees_delete_admin on public.meeting_attendees;
create policy meeting_attendees_delete_admin
  on public.meeting_attendees
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.meeting_attendees to authenticated;
revoke all on public.meeting_attendees from anon;
