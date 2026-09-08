-- ============================================================================
-- 0058 — prospect_intakes: public/shareable pre-client intake (P1).
--
-- A prospect is NOT a client. This table holds pre-sales intake submissions
-- captured through the public /start flow (generic link or personalised
-- tokenised link) BEFORE any explicit admin "Convert to Client". Prospects are
-- structurally separate from `clients` — they never appear in the Clients list,
-- client counts, workspace, or reporting, and converting is a deliberate later
-- (P4) admin action that reuses the existing client-creation architecture.
--
-- Security model (mirrors the reschedule token + service-role write precedents):
--   • Only the SHA-256 hash of the link token is stored; the raw token lives
--     only in the URL and is never persisted.
--   • RLS: admins manage all; NO client policy; anon has NO access. Every public
--     (unauthenticated) read/write happens through a server action using the
--     service-role client AFTER validating the token hash — never via anon RLS.
--
-- Additive, nullable where not essential, ZERO backfill. No change to clients,
-- client_services, onboarding_submissions, auth, or any existing RLS policy.
--
-- NUMBERING: 0058.
-- ============================================================================

create table if not exists public.prospect_intakes (
  id                  uuid primary key default gen_random_uuid(),

  -- Link token: only the SHA-256 hex is stored (raw token is URL-only).
  token_hash          text not null unique
                        check (char_length(token_hash) = 64),
  token_expires_at    timestamptz not null,

  -- Which link created it, and its lifecycle state.
  source              text not null
                        check (source in ('generic', 'personalised')),
  status              text not null default 'draft'
                        check (status in ('draft', 'submitted', 'converted', 'dismissed')),

  -- Contact fields promoted to columns ONLY where they materially help the
  -- admin list / search / dedupe / conversion. Everything else stays in `data`.
  business_name       text,
  contact_name        text,
  email               text,
  phone               text,

  -- The services the prospect is interested in (subset of the bounded catalog).
  selected_services   text[] not null default '{}'::text[]
                        check (selected_services <@ array['website','google_ads','meta_ads','seo']::text[]),

  -- All intake answers, keyed by the SAME stable field names as
  -- onboarding_submissions.data so they can carry forward on conversion.
  data                jsonb not null default '{}'::jsonb,

  -- The admin who created a personalised intake (null for generic).
  created_by          uuid references public.profiles (id) on delete set null,

  -- Set once, on conversion (P4). Its presence is the idempotency guard: a
  -- prospect must never produce two clients. ON DELETE SET NULL so deleting a
  -- client never blocks on a historical prospect link.
  converted_client_id uuid references public.clients (id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  converted_at        timestamptz
);

-- Admin list / triage (submitted first, newest first) and dedupe by email.
create index if not exists prospect_intakes_status_created_idx
  on public.prospect_intakes (status, created_at desc);
create index if not exists prospect_intakes_email_idx
  on public.prospect_intakes (lower(email)) where email is not null;
-- At most one prospect per converted client.
create unique index if not exists prospect_intakes_converted_client_idx
  on public.prospect_intakes (converted_client_id) where converted_client_id is not null;

comment on table public.prospect_intakes is
  'Pre-client public intake submissions (P1). Separate from clients until explicit admin conversion. Token: SHA-256 hash only. RLS admin-only; anon denied; public writes via service-role after token validation.';

-- updated_at trigger (reuses the shared function from 0001).
drop trigger if exists trg_prospect_intakes_updated on public.prospect_intakes;
create trigger trg_prospect_intakes_updated before update on public.prospect_intakes
  for each row execute function public.set_updated_at();

-- ── RLS: admin-only management; anon fully denied; no client access ─────────
alter table public.prospect_intakes enable row level security;

-- Anonymous callers get NOTHING via RLS — the public flow writes via the
-- service-role client only after validating the token hash server-side.
revoke all on public.prospect_intakes from anon;
grant select, insert, update, delete on public.prospect_intakes to authenticated;

drop policy if exists "Admins manage prospect intakes" on public.prospect_intakes;
create policy "Admins manage prospect intakes"
  on public.prospect_intakes for all
  using (public.is_admin())
  with check (public.is_admin());
