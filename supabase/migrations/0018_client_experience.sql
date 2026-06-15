-- ============================================================================
-- Client Experience V1 — data foundation (Phase 0).
--
-- Adds the data the premium client dashboard will read. PRESENTATION-ONLY in
-- spirit: this is purely additive and isolated. Nothing here changes billing,
-- QuickBooks, PayFast, commission, the approval flow, or project/stage logic;
-- existing stages are NOT renamed and stage data is NOT migrated.
--
-- New:
--   • activity_events  — standalone, growable event/audit stream (client-visible
--                        vs internal); powers the Activity Timeline.
--   • team_members     — settings-backed Success Managers (default + future
--                        per-client assignment). Seeds Eloff Sander (Co-Founder).
--   • clients.estimated_launch_date, clients.success_manager_id
--   • project_stages.target_date  (optional per-stage ETA)
--   • Backfill: one client-visible 'project_created' event per existing client.
--
-- NUMBERING: 0018.
-- ============================================================================

-- ── 1. team_members (Success Managers) ─────────────────────────────────────
-- Settings-backed so contact details are never hardcoded in components, and a
-- client can later be assigned a specific manager.
create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  role         text,
  email        text,
  whatsapp     text,
  photo_url    text,
  calendly_url text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- At most one default manager.
create unique index if not exists team_members_single_default_idx
  on public.team_members (is_default)
  where is_default;

-- Seed the default Success Manager (idempotent — only if none exists yet).
insert into public.team_members (name, role, email, is_default)
select 'Eloff Sander', 'Co-Founder', 'info@bbettragency.com', true
where not exists (select 1 from public.team_members where is_default);

alter table public.team_members enable row level security;

drop policy if exists "Admins manage team members" on public.team_members;
create policy "Admins manage team members"
  on public.team_members for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── 2. Additive columns on clients ─────────────────────────────────────────
-- (success_manager_id is added BEFORE the team_members client-read policy below,
--  which references it.)
alter table public.clients
  add column if not exists estimated_launch_date date,
  add column if not exists success_manager_id    uuid
    references public.team_members(id) on delete set null;

-- Clients may read their assigned manager or the default (public contact info).
drop policy if exists "Clients read their success manager" on public.team_members;
create policy "Clients read their success manager"
  on public.team_members for select
  using (
    is_default
    or id = (
      select c.success_manager_id from public.clients c
      where c.id = public.current_client_id()
    )
  );

-- ── 3. Additive column on project_stages (optional per-stage ETA) ──────────
alter table public.project_stages
  add column if not exists target_date date;

-- ── 4. activity_events (standalone event/audit stream) ─────────────────────
create table if not exists public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  type        text not null,                 -- e.g. project_created, invoice_paid, design_started
  title       text not null,                 -- client-facing label
  description text,
  visibility  text not null default 'client'
                check (visibility in ('client', 'internal')),
  icon        text,                          -- optional premium glyph key
  occurred_at timestamptz not null default now(),  -- timeline is newest-first
  source      text not null default 'system'
                check (source in ('system', 'manual')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists activity_events_client_occurred_idx
  on public.activity_events (client_id, occurred_at desc);

alter table public.activity_events enable row level security;

drop policy if exists "Admins manage activity events" on public.activity_events;
create policy "Admins manage activity events"
  on public.activity_events for all
  using (public.is_admin())
  with check (public.is_admin());

-- Clients see only their own CLIENT-visible events (internal events stay hidden).
drop policy if exists "Clients read own visible activity" on public.activity_events;
create policy "Clients read own visible activity"
  on public.activity_events for select
  using (client_id = public.current_client_id() and visibility = 'client');

-- ── 5. Backfill a 'Project Created' event for existing clients ─────────────
-- So every existing client has a non-empty premium timeline immediately. Safe
-- to re-run: only inserts where the client has no project_created event yet.
insert into public.activity_events (client_id, type, title, visibility, occurred_at, source)
select c.id, 'project_created', 'Project Created', 'client', c.created_at, 'system'
from public.clients c
where not exists (
  select 1 from public.activity_events ae
  where ae.client_id = c.id and ae.type = 'project_created'
);
