-- ============================================================================
-- Sales Rep Portal — reps close deals and raise invoice requests for admin
-- approval. Fully additive: does not alter existing client/admin tables.
--
-- NOTE: if Supabase reports "unsafe use of new value of enum type", run the
-- single `alter type user_role add value …` line on its own first, then the
-- rest of this file.
-- ============================================================================

-- Additive role (safe / idempotent).
alter type user_role add value if not exists 'rep';

create type billing_type as enum ('once_off', 'monthly');
create type deal_status as enum ('new', 'invoice_requested', 'invoiced', 'won', 'lost');
create type invoice_request_status as enum ('pending', 'approved', 'rejected', 'invoiced', 'failed');
create type commission_status as enum ('pending', 'paid');

-- Helper: is the current user a sales rep? (Body executes at query time, after
-- the enum value exists, so this is safe.)
create or replace function public.is_rep()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'rep'
  );
$$;

-- Rep metadata (1:1 with a profiles row).
create table reps (
  id              uuid primary key references profiles(id) on delete cascade,
  display_name    text,
  commission_rate numeric(5,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table deals (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references profiles(id) on delete cascade,
  business_name text not null,
  contact_name  text,
  email         text,
  phone         text,
  package       text,
  price         numeric(12,2),
  billing_type  billing_type not null default 'once_off',
  notes         text,
  status        deal_status not null default 'new',
  client_id     uuid references clients(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index deals_rep_idx on deals(rep_id, created_at desc);

create table invoice_requests (
  id                     uuid primary key default gen_random_uuid(),
  deal_id                uuid not null references deals(id) on delete cascade,
  rep_id                 uuid not null references profiles(id) on delete cascade,
  amount                 numeric(12,2) not null,
  billing_type           billing_type not null,
  status                 invoice_request_status not null default 'pending',
  quickbooks_invoice_id  text,
  quickbooks_customer_id text,
  approved_by            uuid references profiles(id) on delete set null,
  error                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index invoice_requests_status_idx on invoice_requests(status, created_at desc);

create table commissions (
  id         uuid primary key default gen_random_uuid(),
  rep_id     uuid not null references profiles(id) on delete cascade,
  deal_id    uuid not null references deals(id) on delete cascade,
  amount     numeric(12,2) not null,
  rate       numeric(5,2) not null default 0,
  status     commission_status not null default 'pending',
  created_at timestamptz not null default now()
);

create trigger trg_deals_updated before update on deals
  for each row execute function public.set_updated_at();
create trigger trg_invoice_requests_updated before update on invoice_requests
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table reps             enable row level security;
alter table deals            enable row level security;
alter table invoice_requests enable row level security;
alter table commissions      enable row level security;

-- reps
create policy "Admins manage reps" on reps for all
  using (is_admin()) with check (is_admin());
create policy "Reps read own rep row" on reps for select
  using (id = auth.uid());

-- deals — reps see/create only their own; admins see all.
create policy "Admins manage all deals" on deals for all
  using (is_admin()) with check (is_admin());
create policy "Reps read own deals" on deals for select
  using (rep_id = auth.uid());
create policy "Reps create own deals" on deals for insert
  with check (rep_id = auth.uid() and is_rep());
create policy "Reps update own deals" on deals for update
  using (rep_id = auth.uid()) with check (rep_id = auth.uid());

-- invoice_requests — reps create/read their own; only admins change status.
create policy "Admins manage all invoice requests" on invoice_requests for all
  using (is_admin()) with check (is_admin());
create policy "Reps read own invoice requests" on invoice_requests for select
  using (rep_id = auth.uid());
create policy "Reps create own invoice requests" on invoice_requests for insert
  with check (rep_id = auth.uid() and is_rep());

-- commissions — admins manage; reps read their own.
create policy "Admins manage commissions" on commissions for all
  using (is_admin()) with check (is_admin());
create policy "Reps read own commissions" on commissions for select
  using (rep_id = auth.uid());
