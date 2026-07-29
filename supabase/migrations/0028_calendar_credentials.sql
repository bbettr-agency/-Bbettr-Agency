-- ============================================================================
-- Bbettr OS — shared Google Calendar credential (internal, ADMIN-ONLY).
--
-- Ported verbatim from the standalone Planner's 0003 + 0004 (audit FKs pointed
-- at the Portal's public.profiles). A single-row table holding the shared-account
-- OAuth refresh token, encrypted at the application layer (AES-256-GCM). Google
-- Calendar remains the source of truth for meetings; NO event data is stored here.
--
-- Security posture (unchanged from the proven Planner design):
--  * RLS enabled + forced with NO policies → unreachable by anon or ANY normal
--    authenticated session (including admins). Only trusted server code using the
--    Supabase SECRET key (service_role, which bypasses RLS) reads/writes it.
--  * Privileges also revoked from anon/authenticated (belt and suspenders).
--  * The refresh token is stored ONLY as ciphertext (iv|tag|ciphertext, base64);
--    never plaintext, never an env var, never in source.
--
-- Additive and isolated; touches nothing existing.
--
-- NUMBERING: 0028.
-- ============================================================================

create table if not exists public.calendar_credentials (
  id                    integer primary key default 1 check (id = 1), -- single row
  provider              text not null default 'google',

  -- Connection metadata (safe to read server-side; never the token):
  google_account_email  text,          -- connected account (e.g. info@bbettragency.com)
  google_calendar_id    text,          -- the calendar operated on
  scopes                text,          -- granted scopes
  status                text not null default 'disconnected'
                          check (status in ('connected', 'reconnect_required', 'disconnected')),

  -- Secret (ciphertext only; null when disconnected):
  refresh_token_enc     text,

  -- Audit:
  connected_by          uuid references public.profiles (id),
  connected_at          timestamptz,
  updated_at            timestamptz not null default now(),
  disconnected_by       uuid references public.profiles (id),
  disconnected_at       timestamptz
);

comment on table public.calendar_credentials is
  'Single shared Google Calendar OAuth credential. Refresh token stored AES-256-GCM encrypted. No event data. RLS-locked; server-secret (service_role) access only.';

alter table public.calendar_credentials enable row level security;
alter table public.calendar_credentials force row level security;

-- Intentionally NO policies: every anon/authenticated request is denied,
-- including admins. Only service_role (secret key, bypasses RLS) reaches it.

-- Belt and suspenders: no table privileges for browser-facing roles.
revoke all on public.calendar_credentials from anon;
revoke all on public.calendar_credentials from authenticated;

-- Explicit service_role grant (Supabase's default is not guaranteed per project;
-- without this the elevated server client could hit "permission denied").
grant all on public.calendar_credentials to service_role;
