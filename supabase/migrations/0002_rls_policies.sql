-- ============================================================================
-- Row-Level Security — the multi-tenant isolation boundary.
--
-- Rule of thumb for every tenant-scoped table:
--   * Admins (is_admin()) can do everything.
--   * Clients can only touch rows where client_id = current_client_id().
-- ============================================================================

alter table clients                enable row level security;
alter table profiles               enable row level security;
alter table client_services        enable row level security;
alter table onboarding_submissions enable row level security;
alter table project_stages         enable row level security;
alter table updates                enable row level security;
alter table reports                enable row level security;
alter table files                  enable row level security;

-- ── clients ────────────────────────────────────────────────────────────────
create policy "Admins manage all clients"
  on clients for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own tenant"
  on clients for select
  using (id = current_client_id());

-- ── profiles ───────────────────────────────────────────────────────────────
create policy "Users read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Admins read all profiles"
  on profiles for select
  using (is_admin());

create policy "Users update own profile"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Admins manage profiles"
  on profiles for all
  using (is_admin())
  with check (is_admin());

-- ── client_services ─────────────────────────────────────────────────────────
create policy "Admins manage all services"
  on client_services for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own services"
  on client_services for select
  using (client_id = current_client_id());

-- ── onboarding_submissions ──────────────────────────────────────────────────
create policy "Admins manage all onboarding"
  on onboarding_submissions for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own onboarding"
  on onboarding_submissions for select
  using (client_id = current_client_id());

create policy "Clients insert own onboarding"
  on onboarding_submissions for insert
  with check (client_id = current_client_id());

create policy "Clients update own onboarding"
  on onboarding_submissions for update
  using (client_id = current_client_id())
  with check (client_id = current_client_id());

-- ── project_stages ──────────────────────────────────────────────────────────
create policy "Admins manage all stages"
  on project_stages for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own stages"
  on project_stages for select
  using (client_id = current_client_id());

-- ── updates ─────────────────────────────────────────────────────────────────
create policy "Admins manage all updates"
  on updates for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own updates"
  on updates for select
  using (client_id = current_client_id());

-- ── reports ─────────────────────────────────────────────────────────────────
create policy "Admins manage all reports"
  on reports for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own reports"
  on reports for select
  using (client_id = current_client_id());

-- ── files ───────────────────────────────────────────────────────────────────
create policy "Admins manage all files"
  on files for all
  using (is_admin())
  with check (is_admin());

create policy "Clients read own files"
  on files for select
  using (client_id = current_client_id());

create policy "Clients insert own files"
  on files for insert
  with check (client_id = current_client_id());

create policy "Clients delete own files"
  on files for delete
  using (client_id = current_client_id());
