-- ============================================================================
-- Structured service package on deals (Phase 2.2). Additive and isolated:
-- adds three nullable columns to `deals` so a rep picks a controlled service
-- package on the New Deal form. Nothing here touches commissions, the approval
-- flow, clients or the client portal.
--
-- Why text (not an enum): the package catalogue evolves often (added/renamed
-- packages). `package_key` is validated in the app against src/lib/packages.ts,
-- so new packages never need a migration. The display label continues to live
-- in the existing `deals.package` column (kept populated for existing UI/email).
--
-- NUMBERING: 0013 (prod runs 0001-0012). PayFast, when built, becomes 0014.
-- ============================================================================

alter table public.deals
  -- Catalogue key for the chosen package (e.g. 'new_website', 'meta_ads',
  -- 'custom'). Validated server-side; null on legacy deals.
  add column if not exists package_key text,
  -- Custom package only: the product/service name the rep entered.
  add column if not exists custom_package_name text,
  -- Custom package only: the invoice description the rep entered.
  add column if not exists custom_package_description text;

comment on column public.deals.package_key is
  'Service package catalogue key (validated against src/lib/packages.ts).';
comment on column public.deals.custom_package_name is
  'Custom package: product/service name (only when package_key = custom).';
comment on column public.deals.custom_package_description is
  'Custom package: invoice description (only when package_key = custom).';
