-- ============================================================================
-- Bbettr Agency Client Portal — Initial Schema
-- Multi-tenant SaaS. Tenancy is enforced at the database layer via RLS.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------------
create type user_role as enum ('admin', 'client');
create type client_status as enum (
  'lead', 'onboarding', 'in_progress', 'active', 'paused', 'completed'
);
create type service_type as enum ('website', 'google_ads', 'meta_ads', 'seo');
create type onboarding_status as enum (
  'not_started', 'in_progress', 'submitted', 'approved'
);
create type stage_status as enum ('completed', 'in_progress', 'pending');
create type file_category as enum (
  'logo', 'image', 'video', 'pdf', 'brand_guide', 'document', 'report'
);

-- ============================================================================
-- TENANTS: clients
-- Each row is a tenant. All tenant-scoped tables reference clients(id).
-- ============================================================================
create table clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  company       text,
  status        client_status not null default 'onboarding',
  logo_url      text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================================
-- USERS: profiles
-- Links auth.users -> role + tenant. The keystone of the security model.
-- ============================================================================
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'client',
  client_id  uuid references clients(id) on delete set null,
  full_name  text,
  email      text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index profiles_client_id_idx on profiles(client_id);

-- ============================================================================
-- Helper functions (SECURITY DEFINER) used by RLS policies.
-- These avoid recursive RLS lookups on the profiles table.
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_client_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select client_id from profiles where id = auth.uid();
$$;

-- ============================================================================
-- client_services: which services a tenant has purchased
-- ============================================================================
create table client_services (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  service           service_type not null,
  onboarding_status onboarding_status not null default 'not_started',
  created_at        timestamptz not null default now(),
  unique (client_id, service)
);
create index client_services_client_id_idx on client_services(client_id);

-- ============================================================================
-- onboarding_submissions: dynamic per-service form data (JSONB)
-- ============================================================================
create table onboarding_submissions (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  service      service_type not null,
  data         jsonb not null default '{}'::jsonb,
  status       onboarding_status not null default 'in_progress',
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, service)
);
create index onboarding_client_id_idx on onboarding_submissions(client_id);

-- ============================================================================
-- project_stages: the progress tracker
-- ============================================================================
create table project_stages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  description text,
  status      stage_status not null default 'pending',
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index project_stages_client_id_idx on project_stages(client_id);

-- ============================================================================
-- updates: project update feed
-- ============================================================================
create table updates (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  title        text not null,
  body         text not null,
  published_at timestamptz not null default now(),
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text,
  created_at   timestamptz not null default now()
);
create index updates_client_id_idx on updates(client_id);

-- ============================================================================
-- reports: monthly performance reports
-- ============================================================================
create table reports (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  reporting_month date not null,
  ad_spend        numeric(12,2),
  leads_generated int,
  cost_per_lead   numeric(12,2),
  clicks          int,
  impressions     bigint,
  conversion_rate numeric(5,2),
  summary         text,
  key_wins        text,
  opportunities   text,
  next_month_plan text,
  pdf_path        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, reporting_month)
);
create index reports_client_id_idx on reports(client_id);

-- ============================================================================
-- files: metadata for files stored in Supabase Storage
-- ============================================================================
create table files (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  path        text not null,
  category    file_category not null default 'document',
  mime_type   text,
  size_bytes  bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index files_client_id_idx on files(client_id);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_clients_updated   before update on clients
  for each row execute function public.set_updated_at();
create trigger trg_onboarding_updated before update on onboarding_submissions
  for each row execute function public.set_updated_at();
create trigger trg_stages_updated     before update on project_stages
  for each row execute function public.set_updated_at();
create trigger trg_reports_updated    before update on reports
  for each row execute function public.set_updated_at();

-- ============================================================================
-- New auth user -> profile bootstrap.
-- Reads role/client_id from the invite metadata set by the admin flow.
--
-- ⚠️ SECURITY: this trusts `role` from raw_user_meta_data. That is only safe
-- because the sole code path that sets it is the admin "Create client" server
-- action (gated by requireAdmin + the service-role key). PUBLIC SIGN-UP MUST BE
-- DISABLED in Supabase (Authentication → Providers → Email → disallow new
-- sign-ups); otherwise a user could self-register as an admin. See README
-- "Required security settings before go-live".
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, client_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'client'),
    nullif(new.raw_user_meta_data ->> 'client_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
