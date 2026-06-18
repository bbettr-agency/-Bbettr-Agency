-- ============================================================================
-- Deal pricing currency (Rep Portal deal-creation cleanup).
--
-- Adds an explicit per-deal currency, set from the rep's "Pricing Type" choice
-- on the New Deal form (Local Price = ZAR, International Price = USD). Currency
-- is the rep's explicit selection — NOT derived from client location (which only
-- routes the payment method). It carries through to the QuickBooks invoice.
--
-- Additive and isolated: one nullable-with-default column on deals. Existing
-- deals default to ZAR (the historic behaviour). Nothing here changes PayFast,
-- commissions, intake, client billing (E1), or the SA/EFT routing.
--
-- NUMBERING: 0024 (prod runs 0001-0023).
-- ============================================================================

alter table public.deals
  add column if not exists currency text not null default 'ZAR'
    check (currency in ('ZAR', 'USD'));
