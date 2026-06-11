-- ============================================================================
-- QuickBooks audit & status-integrity hardening (Phase 2.1). Fully additive and
-- isolated: adds diagnostic columns to invoice_requests only. Nothing here
-- changes clients, the client portal, commissions, notifications or email, and
-- it does not alter any existing column.
--
-- Motivation: a request could be marked "invoiced" with a number that the admin
-- could not reconcile against QuickBooks (wrong realm / unverified create / no
-- email actually sent). These columns let us (a) record which realm the invoice
-- was raised in, (b) record whether the QBO email send was confirmed, and
-- (c) persist the raw QBO responses + last-attempt time for troubleshooting.
--
-- NUMBERING: this is 0012 (prod runs 0001-0011: 0011 = quickbooks). PayFast,
-- when built, becomes 0013.
-- ============================================================================

alter table public.invoice_requests
  -- The QBO company (realm) the invoice was actually created in, so an admin can
  -- match the portal record to the right QuickBooks company.
  add column if not exists quickbooks_realm_id text,
  -- Whether QuickBooks confirmed the invoice email send: 'sent' | 'failed' |
  -- 'no_email' (no client email on the deal) | null (not attempted yet).
  add column if not exists quickbooks_email_status text,
  -- When QuickBooks confirmed the email was sent.
  add column if not exists quickbooks_emailed_at timestamptz,
  -- When invoicing was last attempted (approval or retry), success or failure.
  add column if not exists quickbooks_last_attempt_at timestamptz,
  -- Structured log of the last attempt: customer action + id, invoice id +
  -- number, email result, and raw error payloads. Admin-only diagnostics.
  add column if not exists quickbooks_log jsonb;

comment on column public.invoice_requests.quickbooks_realm_id is
  'QBO realm/company id the invoice was created in (audit/reconciliation).';
comment on column public.invoice_requests.quickbooks_email_status is
  'QBO invoice email send result: sent | failed | no_email | null.';
comment on column public.invoice_requests.quickbooks_log is
  'Last-attempt QuickBooks diagnostics (customer/invoice/send responses, errors).';
