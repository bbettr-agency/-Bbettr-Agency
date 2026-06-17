-- ============================================================================
-- Client Billing foundation (Phase E1) — a CLIENT-CENTRIC billing ledger that
-- lives under the client record (not under deals). Manual V1: admins create
-- invoices, record payments, and track retainers by hand.
--
-- Additive and isolated: three new tables + one number sequence. Nothing here
-- changes QuickBooks, PayFast, commissions, the rep/deal flow, the D2 observers,
-- or any existing table. No recurring engine, no QBO/PayFast write integration,
-- no client-facing access (admin-only RLS) — those are later phases.
--
--   client_invoices  — the ledger (many per client; INV-NNNNNN numbers)
--   client_payments  — payment history (partial-payment ready)
--   client_retainers — record-only monthly retainer tracking
--
-- Overdue is DERIVED in queries (status='sent' AND due_at < now()), never stored,
-- so no scheduled job is required.
--
-- NUMBERING: 0023 (prod runs 0001-0022).
-- ============================================================================

-- ── 1. client_invoices ──────────────────────────────────────────────────────
create table if not exists public.client_invoices (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.clients(id) on delete cascade,
  invoice_number            text not null unique,                 -- INV-000001
  title                     text not null,
  description               text,
  amount                    numeric(12,2) not null check (amount >= 0),
  currency                  text not null default 'ZAR',
  kind                      text not null default 'one_off'
                              check (kind in ('one_off', 'retainer', 'custom')),
  status                    text not null default 'draft'
                              check (status in ('draft', 'sent', 'paid', 'void')),
  issued_at                 timestamptz,
  due_at                    timestamptz,
  paid_at                   timestamptz,
  -- Reference-only links (no write integration in E1).
  quickbooks_invoice_id     text,
  quickbooks_invoice_number text,
  invoice_request_id        uuid references public.invoice_requests(id) on delete set null,
  source                    text not null default 'admin'
                              check (source in ('admin', 'rep_deal', 'quickbooks')),
  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists client_invoices_client_idx
  on public.client_invoices (client_id, created_at desc);
create index if not exists client_invoices_client_status_idx
  on public.client_invoices (client_id, status);

-- ── 2. client_payments (payment history) ────────────────────────────────────
create table if not exists public.client_payments (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  -- Nullable: allows ad-hoc / credit payments not tied to a single invoice.
  invoice_id         uuid references public.client_invoices(id) on delete set null,
  amount             numeric(12,2) not null check (amount > 0),
  method             text not null default 'manual'
                       check (method in ('eft', 'payfast', 'quickbooks', 'cash', 'manual')),
  reference          text,
  payfast_payment_id uuid references public.payfast_payments(id) on delete set null,
  received_at        timestamptz not null default now(),
  recorded_by        uuid references public.profiles(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists client_payments_client_idx
  on public.client_payments (client_id, received_at desc);
create index if not exists client_payments_invoice_idx
  on public.client_payments (invoice_id);

-- ── 3. client_retainers (record-only) ───────────────────────────────────────
create table if not exists public.client_retainers (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  cadence     text not null default 'monthly' check (cadence in ('monthly')),
  active      boolean not null default true,
  started_at  date,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists client_retainers_client_idx
  on public.client_retainers (client_id);

-- ── 4. Invoice-number sequence (mirror of 0014's BBTTR- pattern) ────────────
create sequence if not exists public.client_invoice_number_seq;

-- Continue from the highest INV- number already assigned (none on first run, so
-- the next nextval() returns 1 → INV-000001). is_called=false → next value is
-- exactly max_n + 1.
do $$
declare
  max_n bigint;
begin
  select coalesce(
           max(substring(invoice_number from '^INV-([0-9]+)$')::bigint),
           0
         )
    into max_n
  from public.client_invoices
  where invoice_number ~ '^INV-[0-9]+$';

  perform setval('public.client_invoice_number_seq', max_n + 1, false);
end $$;

create or replace function public.next_client_invoice_number()
returns text
language sql
volatile
as $$
  select 'INV-' || lpad(nextval('public.client_invoice_number_seq')::text, 6, '0');
$$;

grant execute on function public.next_client_invoice_number() to authenticated;

-- ── 5. updated_at triggers (reuse existing helper) ──────────────────────────
drop trigger if exists trg_client_invoices_updated on public.client_invoices;
create trigger trg_client_invoices_updated before update on public.client_invoices
  for each row execute function public.set_updated_at();

drop trigger if exists trg_client_retainers_updated on public.client_retainers;
create trigger trg_client_retainers_updated before update on public.client_retainers
  for each row execute function public.set_updated_at();

-- ── 6. RLS — admin-only in E1 (client-facing access deferred to a later phase) ─
alter table public.client_invoices  enable row level security;
alter table public.client_payments  enable row level security;
alter table public.client_retainers enable row level security;

drop policy if exists "Admins manage client invoices" on public.client_invoices;
create policy "Admins manage client invoices" on public.client_invoices
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins manage client payments" on public.client_payments;
create policy "Admins manage client payments" on public.client_payments
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins manage client retainers" on public.client_retainers;
create policy "Admins manage client retainers" on public.client_retainers
  for all using (public.is_admin()) with check (public.is_admin());
