-- ============================================================================
-- PayFast ITN (Instant Transaction Notification) audit columns — Phase 3, V2.
-- Adds the forensic fields the /api/payfast/notify webhook writes when PayFast
-- notifies us of a payment. Status auto-flips pending → paid on a verified
-- COMPLETE ITN; the manual admin "Mark as paid" stays as a fallback.
--
-- Additive and isolated: only NULLABLE columns on payfast_payments. Nothing
-- here changes commissions, QuickBooks, the approval flow, deals, the SA/EFT
-- flow, or PayFast V1 link generation. RLS is row-level, so the existing
-- admin/rep policies cover these new columns automatically.
--
-- (raw_itn, pf_payment_id, paid_at and the status check already exist from 0016.)
--
-- NUMBERING: 0017.
-- ============================================================================

alter table public.payfast_payments
  add column if not exists pf_payment_status text,        -- raw PayFast payment_status
  add column if not exists amount_gross      numeric(12,2), -- amount PayFast reported
  add column if not exists itn_received_at   timestamptz,  -- last ITN timestamp
  add column if not exists itn_valid         boolean,      -- did the last ITN pass all checks
  add column if not exists itn_error         text;         -- rejection reason (debugging)
