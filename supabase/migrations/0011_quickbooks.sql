-- ============================================================================
-- QuickBooks Online integration (Phase 2) — create QBO invoices when an admin
-- approves an invoice request. Fully additive and isolated: touches only the
-- sales-rep tables (deals / invoice_requests) and adds one new singleton table.
-- Nothing here affects clients, the client portal, notifications or email.
--
-- Tokens are encrypted at rest by the application (AES-256-GCM via
-- QBO_TOKEN_SECRET) before being written here, so the columns hold ciphertext.
-- This table is only ever read/written by the service-role client; RLS is
-- enabled (admin-only) as defence-in-depth.
--
-- NUMBERING: re-integrated onto the V1 baseline as 0011 (prod runs 0001–0010:
-- 0009 = rep hardening, 0010 = deal client location). Previously drafted as 0009
-- on the old QuickBooks branch.
-- ============================================================================

-- ── Single-row OAuth connection (one QBO company per portal) ────────────────
create table if not exists quickbooks_connection (
  id                 boolean primary key default true check (id),
  realm_id           text not null,
  access_token       text not null,          -- encrypted
  refresh_token      text not null,          -- encrypted
  token_expires_at   timestamptz not null,
  refresh_expires_at timestamptz,
  environment        text not null default 'production',
  company_name       text,
  connected_by       uuid references profiles(id) on delete set null,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_quickbooks_connection_updated
  before update on quickbooks_connection
  for each row execute function public.set_updated_at();

alter table quickbooks_connection enable row level security;

-- Admin-only (the app uses the service-role client for token operations).
create policy "Admins manage quickbooks connection" on quickbooks_connection
  for all using (is_admin()) with check (is_admin());

-- ── Invoice-request: record the created QBO invoice ─────────────────────────
alter table invoice_requests
  add column if not exists quickbooks_invoice_number text,
  add column if not exists invoiced_at timestamptz;

-- ── Deal: remember the QBO customer so repeat invoices reuse it ─────────────
alter table deals
  add column if not exists quickbooks_customer_id text;
