-- ============================================================================
-- Client notifications — tracks when a client last viewed each portal section.
--
-- A section shows a notification dot when the latest activity in that section
-- (a stage change, new update, new report, new file) is more recent than the
-- client's last view. Designed to later be driven by Supabase Realtime without
-- changing this model.
-- ============================================================================

create table client_section_views (
  client_id      uuid not null references clients(id) on delete cascade,
  section        text not null,            -- 'project' | 'updates' | 'reports' | 'files'
  last_viewed_at timestamptz not null default now(),
  primary key (client_id, section)
);

alter table client_section_views enable row level security;

-- Admins can see everything (useful for support/debugging).
create policy "Admins read all section views"
  on client_section_views for select
  using (is_admin());

-- A client owns their own view records and may read/insert/update them.
-- (This is the client's own data, so unlike status/stages it is safe to grant
--  direct write access here.)
create policy "Clients read own section views"
  on client_section_views for select
  using (client_id = current_client_id());

create policy "Clients insert own section views"
  on client_section_views for insert
  with check (client_id = current_client_id());

create policy "Clients update own section views"
  on client_section_views for update
  using (client_id = current_client_id())
  with check (client_id = current_client_id());
