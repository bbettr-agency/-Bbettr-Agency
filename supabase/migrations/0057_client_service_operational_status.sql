-- ============================================================================
-- 0057 — Per-service OPERATIONAL status on client_services.
--
-- Adds the authoritative stored operational state for Google Ads / Meta Ads /
-- SEO (live / paused / being set up) — a DIFFERENT concept from onboarding_status.
-- Website ignores this column and derives its state from the roadmap + website
-- URLs (application layer), so the two can never contradict.
--
-- Additive, nullable, ZERO backfill. NULL means "no explicit operational state"
-- and is resolved conservatively in the app (never to active/paused). No FK, no
-- default. Covered by the EXISTING client_services RLS (admins manage all;
-- clients read their own row) — no new policy, no RLS change.
--
-- NUMBERING: 0057.
-- ============================================================================

alter table public.client_services
  add column if not exists operational_status text
    check (
      operational_status is null
      or operational_status in ('not_started', 'setup', 'in_progress', 'active', 'paused')
    );

comment on column public.client_services.operational_status is
  'Stored operational state for ads/SEO (not_started|setup|in_progress|active|paused). NULL = unset, resolved conservatively in-app (never active/paused). Website IGNORES this and derives from roadmap + website URLs. NOT onboarding_status.';
