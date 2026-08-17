-- ============================================================================
-- Bbettr OS — Client invoice / billing details.
--
-- A CLIENT-OWNED billing PROFILE (who to invoice + how), collected during
-- onboarding and shared across every service. This is NOT the invoice ledger
-- (client_invoices/client_payments/client_retainers, 0023/0025) — that holds
-- amounts and is untouched here. This holds the client's billing IDENTITY.
--
-- Design (all locked):
--   • 1:1 with clients — PRIMARY KEY = client_id — so a client has exactly ONE
--     billing profile shared across all onboarding/services (no duplicates), and
--     ON DELETE CASCADE cleans it up with the client.
--   • A dedicated table (NOT columns on clients) so the client can edit their own
--     billing without widening UPDATE access to the rest of the clients row, and
--     so billing never leaks into unrelated client payloads.
--   • All detail fields NULLABLE at the DB (draft-friendly incremental saves,
--     matching onboarding_submissions). Required-field validation
--     (invoice_name + an effective billing email) is enforced in the application
--     on submit, not by NOT NULL — so partial drafts are allowed.
--   • "Billing email same as contact": a boolean flag. When true the effective
--     email is resolved from clients.contact_email at read time (not duplicated
--     here); when false an explicit billing_email is required by the app.
--   • South African reality: company registration, VAT, PO/reference and a
--     formal billing address are all OPTIONAL — not every client is a registered
--     or VAT-registered company.
--
-- Touches NOTHING existing: no change to clients (or its RLS), the invoice
-- ledger, onboarding_submissions, or any enum/trigger. No backfill.
--
-- NUMBERING: 0055.
-- ============================================================================

create table if not exists public.client_billing_details (
  client_id                     uuid primary key
                                  references public.clients(id) on delete cascade,

  invoice_name                  text
                                  check (invoice_name is null or char_length(invoice_name) <= 200),
  company_registration_number   text
                                  check (company_registration_number is null or char_length(company_registration_number) <= 50),
  vat_number                    text
                                  check (vat_number is null or char_length(vat_number) <= 30),

  -- Effective billing email when NOT "same as contact" (else resolved from
  -- clients.contact_email by the app; left NULL here to avoid drift/duplication).
  billing_email                 text
                                  check (billing_email is null or char_length(billing_email) <= 254),
  billing_email_same_as_contact boolean not null default false,

  billing_contact_name          text
                                  check (billing_contact_name is null or char_length(billing_contact_name) <= 200),
  billing_address               text
                                  check (billing_address is null or char_length(billing_address) <= 1000),
  po_reference                  text
                                  check (po_reference is null or char_length(po_reference) <= 120),
  invoice_instructions          text
                                  check (invoice_instructions is null or char_length(invoice_instructions) <= 2000),

  -- Who last edited (client or admin) — audit clarity; nulled if that profile goes.
  updated_by                    uuid references public.profiles(id) on delete set null,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

comment on table public.client_billing_details is
  'Client-owned billing profile (invoice identity) — 1:1 with clients, shared across all services. NOT the invoice ledger. Client-editable under RLS; admins manage all.';
comment on column public.client_billing_details.billing_email_same_as_contact is
  'When true, the effective billing email is resolved from clients.contact_email at read time; billing_email is left NULL to avoid duplication/drift.';

-- updated_at maintained by the existing shared trigger helper (0001).
drop trigger if exists trg_client_billing_details_updated on public.client_billing_details;
create trigger trg_client_billing_details_updated
  before update on public.client_billing_details
  for each row execute function public.set_updated_at();

-- ── RLS — admins manage all; clients manage their OWN (no client DELETE) ─────
alter table public.client_billing_details enable row level security;

drop policy if exists "Admins manage client billing details" on public.client_billing_details;
create policy "Admins manage client billing details"
  on public.client_billing_details
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Clients read own billing details" on public.client_billing_details;
create policy "Clients read own billing details"
  on public.client_billing_details
  for select
  using (client_id = public.current_client_id());

drop policy if exists "Clients insert own billing details" on public.client_billing_details;
create policy "Clients insert own billing details"
  on public.client_billing_details
  for insert
  with check (client_id = public.current_client_id());

drop policy if exists "Clients update own billing details" on public.client_billing_details;
create policy "Clients update own billing details"
  on public.client_billing_details
  for update
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

-- No client DELETE policy: billing details must not be casually deletable by the
-- client. Admins may delete (FOR ALL policy), and rows cascade when the client is
-- removed. anon has no access.
grant select, insert, update, delete on public.client_billing_details to authenticated;
revoke all on public.client_billing_details from anon;
