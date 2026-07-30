-- ============================================================================
-- Bbettr OS — Calendar projection state (internal plumbing, SERVICE-ROLE ONLY).
--
-- Phase 3. The REFLECTED/cache layer of the one-way Portal → Google projection.
-- It is deliberately separate from the authoritative Portal entities (meetings):
-- every value here is a cache of a projection and can be cleared and rebuilt from
-- Portal data alone (Reconstructability). Losing this table, a calendar, or a
-- Google account must never cause permanent data loss.
--
-- Security posture (same as calendar_credentials, 0028):
--  * RLS enabled + forced with NO policies → unreachable by anon or ANY normal
--    authenticated session (including admins). Only trusted server code using the
--    Supabase SECRET key (service_role, which bypasses RLS) reads/writes it.
--  * Privileges also revoked from anon/authenticated (belt and suspenders).
--  * The UI never sees raw rows: a trusted server query selects only safe fields
--    (sync_state, meet_state, meet_url, last_sync_at) — never etags, locks or
--    error payloads.
--
-- Fields are entity-agnostic (entity_type, entity_id) so the reconciliation
-- engine is generic; Phase 3 constrains entity_type to 'meeting' (widening to
-- 'task' later is a one-line additive change, not delivered now).
--
-- NUMBERING: 0031.
-- ============================================================================

create table if not exists public.calendar_projections (
  id                 uuid primary key default gen_random_uuid(),

  -- Which authoritative Portal entity this projection reflects (polymorphic key;
  -- no FK by design — the source entity owns lifecycle, this is a rebuildable cache).
  entity_type        text not null default 'meeting' check (entity_type in ('meeting')),
  entity_id          uuid not null,

  -- Target calendar (per-row to keep multi-calendar additive later; set by the
  -- engine from config today).
  google_calendar_id text not null,

  -- Reflected Google identifiers (caches; regenerated on rebuild):
  google_event_id    text,
  -- Deterministic event ids are derived from (entity_id, id_epoch). Advancing the
  -- epoch yields a fresh id namespace for a safe rebuild after deletion.
  id_epoch           integer not null default 0,
  etag               text,

  -- Google Meet is modelled explicitly and separately from event sync:
  meet_url           text,
  meet_state         text not null default 'not_requested'
                       check (meet_state in ('not_requested', 'pending', 'ready', 'failed')),
  last_meet_error    text,                              -- sanitized code/message only

  -- Event sync state machine:
  sync_state         text not null default 'pending'
                       check (sync_state in ('not_applicable', 'pending', 'synced', 'failed', 'disconnected')),
  -- Hash of the desired descriptor last SUCCESSFULLY projected (drives no-op skips
  -- and edit detection). Never holds attendee/content payloads — a digest only.
  synced_hash        text,

  -- Retry/backoff bookkeeping:
  sync_attempts      integer not null default 0,
  next_attempt_at    timestamptz,

  -- Single-flight lock (lock_token lets a worker release only its own lock;
  -- a stale locked_at is reclaimable for recovery):
  locked_at          timestamptz,
  lock_token         uuid,

  last_sync_at       timestamptz,
  last_sync_error    text,                              -- sanitized code/message only

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint calendar_projections_entity_unique unique (entity_type, entity_id)
);

comment on table public.calendar_projections is
  'Reflected Google Calendar projection state (service-role only). A rebuildable cache of the one-way Portal → Google projection; never authoritative. Error fields hold sanitized codes only — never tokens, bodies, attendee data or stack traces.';

-- One Portal entity ↔ at most one Google event.
create unique index if not exists calendar_projections_event_idx
  on public.calendar_projections (google_event_id) where google_event_id is not null;
-- Reconciler work queue: due rows needing another attempt.
create index if not exists calendar_projections_due_idx
  on public.calendar_projections (next_attempt_at) where sync_state in ('pending', 'failed');

-- ── Row Level Security — SERVICE-ROLE ONLY ──────────────────────────────────
alter table public.calendar_projections enable row level security;
alter table public.calendar_projections force row level security;

-- Intentionally NO policies: every anon/authenticated request is denied,
-- including admins. Only service_role (secret key, bypasses RLS) reaches it.

revoke all on public.calendar_projections from anon;
revoke all on public.calendar_projections from authenticated;
grant all on public.calendar_projections to service_role;
