-- ============================================================================
-- Deal client location — where the client is based, so payments can later be
-- routed correctly:
--   south_africa  → QuickBooks invoice / EFT (avoid PayFast fees)
--   international → QuickBooks invoice + (future) online payment link
--
-- This migration ONLY adds + stores the field. No payment/QuickBooks/PayFast
-- behaviour is wired here. Fully additive and idempotent.
--
-- An enum is used (like billing_type / deal_status) so the values are
-- controlled at the database level. New deals default to 'south_africa', which
-- also backfills any existing rows.
--
-- NOTE: numbering — production runs 0001–0009 (0009 = rep portal hardening).
-- This is 0010. The undeployed QuickBooks migration must therefore be renumbered
-- to 0011 (it was previously slated for 0010).
-- ============================================================================

do $$ begin
  create type client_location as enum ('south_africa', 'international');
exception
  when duplicate_object then null;
end $$;

alter table deals
  add column if not exists client_location client_location not null
  default 'south_africa';
