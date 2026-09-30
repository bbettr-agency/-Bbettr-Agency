-- ============================================================================
-- Bbettr OS — Meeting invitation delivery ledger (SERVICE-ROLE ONLY).
--
-- Calendar invitation delivery fix. Google Calendar remains the event/Meet store
-- but NO LONGER emails external guests (sendUpdates=none); the Portal delivers a
-- standards-compliant .ics invitation itself through the authenticated Resend
-- domain. This table is the DURABLE, per-recipient record of that delivery — it
-- is what makes "attendee invited" a separately-observable fact, not something
-- inferred from Google event creation (which was the original silent-failure bug).
--
-- It provides, per (meeting, attendee, sequence, method):
--   * the ICS SEQUENCE actually sent (durable, monotonic per meeting/UID);
--   * the ICS METHOD (request | cancel);
--   * the attendee-facing content signature that produced that revision;
--   * the Resend message id (webhook correlation);
--   * the delivery state (queued → sent → delivered | bounced | complained | failed);
--   * idempotency (a UNIQUE key so a double-click / retry / reconciler rerun can
--     never emit the same logical invitation twice);
--   * timestamps + a sanitized failure reason.
--
-- Security posture (identical to calendar_projections 0031 / calendar_credentials
-- 0028): RLS enabled + FORCED with NO policies → unreachable by anon or ANY normal
-- authenticated session, including admins. Only trusted server code using the
-- service-role key reaches it (the server invitation sender and the signed Resend
-- webhook, neither of which runs under a user session). A future admin-facing read
-- surfaces a safe projection, never raw rows.
--
-- Additive only. No destructive DDL. No change to meetings / meeting_attendees.
--
-- NUMBERING: 0070.
-- ============================================================================

create table if not exists public.meeting_invitations (
  id                 uuid primary key default gen_random_uuid(),

  -- The authoritative Portal meeting this invitation belongs to. Cascade so a
  -- hard-erased meeting takes its delivery ledger with it (there is no delivery
  -- to observe once the meeting no longer exists).
  meeting_id         uuid not null references public.meetings (id) on delete cascade,

  -- Recipient (always stored lowercased/normalised by the sender).
  attendee_email     text not null check (char_length(trim(attendee_email)) > 0),

  -- The ICS METHOD this row represents.
  method             text not null check (method in ('request', 'cancel')),

  -- The ICS SEQUENCE sent to this recipient for this revision. Monotonic per
  -- meeting (per stable UID). Non-negative.
  sequence           integer not null check (sequence >= 0),

  -- The stable ICS UID used (denormalised for observability/debugging;
  -- <meeting-id>@portal.bbettragency.com). Never changes across the lifecycle.
  ics_uid            text not null,

  -- The attendee-facing content signature that produced this revision (a digest
  -- of SUMMARY/DTSTART/DTEND/TZ/LOCATION/Meet-URL/attendee-visible DESCRIPTION/
  -- STATUS). Drives deterministic "did an attendee-visible property materially
  -- change?" decisions. A digest only — never raw content, never secrets.
  content_signature  text not null,

  -- Resend correlation + delivery state machine.
  resend_message_id  text,
  status             text not null default 'queued'
                       check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  last_error         text,                       -- sanitized code/message only — never a raw provider body

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  sent_at            timestamptz,
  delivered_at       timestamptz,

  -- IDEMPOTENCY: one logical invitation per (meeting, recipient, revision, method).
  -- A double-click / browser retry / server-timeout retry / reconciler rerun that
  -- re-derives the same (meeting, attendee, sequence, method) collides here and is
  -- resolved by re-reading the existing row instead of sending again.
  constraint meeting_invitations_logical_unique
    unique (meeting_id, attendee_email, sequence, method)
);

comment on table public.meeting_invitations is
  'Per-recipient calendar invitation delivery ledger (service-role only). Durable ICS SEQUENCE/METHOD + Resend message id + delivery state, so guest notification is an observable fact independent of Google event creation. Idempotent per (meeting, attendee, sequence, method). Failure fields hold sanitized codes only.';

-- Reconciler / emitter reads all rows for a meeting to plan the next revision.
create index if not exists meeting_invitations_meeting_idx
  on public.meeting_invitations (meeting_id);

-- Webhook lookup by Resend message id (only rows that have been dispatched).
create unique index if not exists meeting_invitations_resend_msg_idx
  on public.meeting_invitations (resend_message_id) where resend_message_id is not null;

-- Keep updated_at fresh via the shared trigger function (0001).
drop trigger if exists trg_meeting_invitations_updated_at on public.meeting_invitations;
create trigger trg_meeting_invitations_updated_at
  before update on public.meeting_invitations
  for each row
  execute function public.set_updated_at();

-- ── Row Level Security — SERVICE-ROLE ONLY ──────────────────────────────────
alter table public.meeting_invitations enable row level security;
alter table public.meeting_invitations force row level security;

-- Intentionally NO policies: every anon/authenticated request is denied,
-- including admins. Only service_role (secret key, bypasses RLS) reaches it.

revoke all on public.meeting_invitations from anon;
revoke all on public.meeting_invitations from authenticated;
grant all on public.meeting_invitations to service_role;
