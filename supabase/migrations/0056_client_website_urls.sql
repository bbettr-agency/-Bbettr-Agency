-- ============================================================================
-- 0056 — Bbettr-built website URLs (preview + live) on clients.
--
-- Additive, nullable, ZERO backfill. These are the BBETTR PROJECT's site URLs
-- (the preview we build, then the live/production site) — distinct from the
-- client-supplied `existing_website_url` captured during onboarding
-- (onboarding_submissions.data), which is the client's PRE-EXISTING site and is
-- left untouched.
--
-- Two columns (not one whose meaning flips) so a preview and a live URL can
-- coexist near launch and the client CTA stays unambiguous. No FK, no CHECK, no
-- default. Covered by the EXISTING clients RLS (admins manage all; a client
-- reads its own row) — no new policy, no RLS change.
--
-- NUMBERING: 0056.
-- ============================================================================

alter table public.clients
  add column if not exists website_preview_url text,
  add column if not exists website_live_url    text;

comment on column public.clients.website_preview_url is
  'Bbettr-built site PREVIEW URL (in-development). Nullable; admin-managed. NOT the client-supplied existing_website_url.';
comment on column public.clients.website_live_url is
  'Bbettr-built site LIVE/production URL. Nullable; admin-managed. Presence drives the client "Live" call-to-action.';
