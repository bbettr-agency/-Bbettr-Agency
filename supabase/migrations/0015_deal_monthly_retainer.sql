-- ============================================================================
-- Optional monthly retainer on a deal (Phase 2.4). When a rep adds a retainer,
-- the QuickBooks invoice gets a SECOND line item (the retainer) alongside the
-- once-off package line. Additive and isolated: four nullable/defaulted columns
-- on `deals`; existing rows backfill to "no retainer" and invoice exactly as
-- before. Nothing here changes commissions (the retainer is invoiced but NOT
-- commissioned), the approval flow, service packages, QuickBooks OAuth, or
-- PayFast. This is a one-time second line on the first invoice only — recurring
-- QuickBooks billing is a later feature.
--
-- NUMBERING: 0015 (prod runs 0001-0014). PayFast, when built, becomes 0016.
-- ============================================================================

alter table public.deals
  -- Whether this deal includes a monthly retainer. Defaults false so every
  -- existing deal keeps single-line invoicing.
  add column if not exists has_monthly_retainer boolean not null default false,
  -- Retainer product/service title (required only when the retainer is enabled).
  add column if not exists monthly_retainer_name text,
  -- Retainer invoice line description (required when enabled).
  add column if not exists monthly_retainer_description text,
  -- Retainer amount (required and > 0 when enabled). Invoiced, not commissioned.
  add column if not exists monthly_retainer_amount numeric(12,2);

comment on column public.deals.has_monthly_retainer is
  'When true, the QBO invoice gets a second line for the monthly retainer.';
comment on column public.deals.monthly_retainer_amount is
  'Retainer amount (ZAR). Invoiced as a second line; does NOT affect commission.';
