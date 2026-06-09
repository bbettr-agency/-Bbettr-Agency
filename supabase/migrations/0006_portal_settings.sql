-- ============================================================================
-- Portal settings — a single-row, database-backed config table so admins can
-- toggle global portal behaviour (e.g. maintenance mode) without redeploying.
-- ============================================================================

create table portal_settings (
  id                  boolean primary key default true,
  maintenance_mode    boolean not null default false,
  maintenance_message text,
  updated_at          timestamptz not null default now(),
  -- Enforce a single row.
  constraint portal_settings_singleton check (id = true)
);

-- Seed the singleton row.
insert into portal_settings (id) values (true) on conflict do nothing;

alter table portal_settings enable row level security;

-- The maintenance flag is non-sensitive and the client layout must read it, so
-- any authenticated user may read it.
create policy "Anyone can read portal settings"
  on portal_settings for select
  using (true);

-- Only admins may change settings.
create policy "Admins update portal settings"
  on portal_settings for update
  using (is_admin())
  with check (is_admin());

create policy "Admins insert portal settings"
  on portal_settings for insert
  with check (is_admin());
