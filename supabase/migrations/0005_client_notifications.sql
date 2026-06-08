-- ============================================================================
-- Client notifications — durable event log that powers email notifications now
-- and an in-portal feed / Supabase Realtime later.
--
-- Architecture:  Event → notifications row → email (Resend).
-- Adding a new notification type later requires no schema change beyond the
-- enum value.
-- ============================================================================

create type notification_type as enum (
  'report_published',
  'update_posted',
  'stage_advanced',
  'assets_needed',
  'action_required'
);

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  type            notification_type not null,
  title           text not null,
  body            text,
  link            text,                 -- in-portal path, e.g. /dashboard/reports
  action_required boolean not null default false,
  resolved_at     timestamptz,          -- set when an action_required item is done
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_client_idx on notifications(client_id, created_at desc);

alter table notifications enable row level security;

-- Admins manage everything.
create policy "Admins manage all notifications"
  on notifications for all
  using (is_admin())
  with check (is_admin());

-- Clients read their own and may mark them read (update read_at).
create policy "Clients read own notifications"
  on notifications for select
  using (client_id = current_client_id());

create policy "Clients update own notifications"
  on notifications for update
  using (client_id = current_client_id())
  with check (client_id = current_client_id());
