-- ============================================================================
-- Bbettr OS — application-level idempotency key for meeting creation.
--
-- Phase 3 hardening. A browser refresh, network retry or double-click must never
-- create two meetings. The create server action supplies a client-generated key;
-- a partial-unique index makes a replay a safe no-op (the second insert loses on
-- the unique constraint and the action returns the already-created meeting).
--
-- Additive and isolated: one nullable column + one partial-unique index. Nulls
-- are allowed (legacy / keyless inserts), so the constraint only binds real keys.
--
-- NUMBERING: 0032.
-- ============================================================================

alter table public.meetings
  add column if not exists idempotency_key text;

create unique index if not exists meetings_idempotency_key_idx
  on public.meetings (idempotency_key)
  where idempotency_key is not null;

comment on column public.meetings.idempotency_key is
  'Client-supplied key making meeting creation replay-safe (refresh/retry/double-click). Partial-unique; nulls allowed.';
