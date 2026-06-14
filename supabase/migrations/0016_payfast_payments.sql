-- ============================================================================
-- PayFast payment links for INTERNATIONAL clients (Phase 3, V1). When an
-- international deal is invoiced in QuickBooks, the portal also generates a
-- PayFast payment link so the client can pay by card (ZAR). South African
-- clients are unaffected — they continue with the QuickBooks invoice + EFT and
-- never get a PayFast link.
--
-- V1 scope: generate + store + display the link, with a manual admin
-- "Mark as paid". No ITN/webhook yet (that is V2) — `status` is updated manually
-- until then. Additive and isolated: one new table; nothing here changes
-- commissions, QuickBooks, the approval flow, deals or invoice_requests.
--
-- NUMBERING: 0016 (prod runs 0001-0015).
-- ============================================================================

create table if not exists public.payfast_payments (
  id                  uuid primary key default gen_random_uuid(),
  -- One payment per invoice request (UNIQUE → no duplicate links).
  invoice_request_id  uuid not null unique references public.invoice_requests(id) on delete cascade,
  deal_id             uuid references public.deals(id) on delete cascade,
  -- Our reference sent to PayFast (= invoice_request_id); correlates a future ITN.
  m_payment_id        text not null unique,
  amount              numeric(12,2) not null,
  item_name           text not null,
  -- Tidy portal link (…/pay/<m_payment_id>) that builds + submits the signed
  -- PayFast form. Shared with / emailed to the international client.
  payment_url         text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'paid', 'failed', 'cancelled')),
  pf_payment_id       text,        -- PayFast transaction id (from ITN, V2)
  paid_at             timestamptz,
  marked_paid_by      uuid references public.profiles(id) on delete set null,
  raw_itn             jsonb,       -- last ITN payload (V2 audit)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists payfast_payments_deal_id_idx
  on public.payfast_payments (deal_id);

alter table public.payfast_payments enable row level security;

-- Admins: full access.
drop policy if exists "Admins manage payfast payments" on public.payfast_payments;
create policy "Admins manage payfast payments"
  on public.payfast_payments for all
  using (public.is_admin())
  with check (public.is_admin());

-- Reps: read-only on payments for their own invoice requests.
drop policy if exists "Reps read own payfast payments" on public.payfast_payments;
create policy "Reps read own payfast payments"
  on public.payfast_payments for select
  using (
    exists (
      select 1 from public.invoice_requests ir
      where ir.id = payfast_payments.invoice_request_id
        and ir.rep_id = auth.uid()
    )
  );

-- Writes happen via the service-role client (bypasses RLS); no insert/update
-- policy is granted to rep/admin sessions on purpose.
