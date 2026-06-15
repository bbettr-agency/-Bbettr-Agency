-- ============================================================================
-- Client Intake foundation (Client Intake Automation — Phase C).
--
-- Adds the intake pipeline + legacy/new client distinction. Additive and
-- isolated: nothing here changes QuickBooks, PayFast, commission, onboarding
-- access rules, the dashboard, contracts or files. Invoice/payment observers are
-- NOT included (deferred). Existing clients are backfilled as LEGACY and
-- un-blocked — never falsely marked as having a signed contract.
--
--   onboarding_type : legacy (immediate access) | new (gated intake)
--   intake_status   : the client-level pipeline
--     draft → contract_sent → contract_signed → invoice_sent → paid
--           → portal_access_sent → onboarding_started → onboarding_submitted
--
-- NUMBERING: 0021.
-- ============================================================================

do $$ begin
  create type onboarding_type as enum ('legacy', 'new');
exception when duplicate_object then null; end $$;

do $$ begin
  create type intake_status as enum (
    'draft', 'contract_sent', 'contract_signed', 'invoice_sent', 'paid',
    'portal_access_sent', 'onboarding_started', 'onboarding_submitted'
  );
exception when duplicate_object then null; end $$;

alter table public.clients
  add column if not exists onboarding_type onboarding_type not null default 'legacy',
  add column if not exists intake_status   intake_status   not null default 'draft',
  add column if not exists portal_access_granted_at timestamptz,
  add column if not exists portal_access_granted_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists welcome_email_sent_at timestamptz;

-- Backfill existing clients: they are already operating, so treat them as LEGACY
-- and move them past the intake gate WITHOUT asserting a signed contract.
-- Idempotent: legacy clients created later by the app start at 'onboarding_started'
-- (set in code) and new clients are onboarding_type='new', so neither is matched
-- on a re-run.
update public.clients
  set intake_status = 'onboarding_started'
  where onboarding_type = 'legacy' and intake_status = 'draft';
