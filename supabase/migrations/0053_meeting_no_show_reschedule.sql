-- ============================================================================
-- Bbettr OS — Meeting no-show + secure self-service rescheduling.
--
-- Additive and isolated. Extends the existing meetings entity (0029) with:
--   • two no-show annotation columns (inert to the Google projection — the
--     desired-state hash never reads them, so marking a no-show performs NO
--     calendar write and sends NO guest updates);
--   • a hashed, single-use, expiring self-service reschedule token (raw token
--     lives only in the emailed URL; only its SHA-256 hex is persisted);
--   • ONE atomic, service-role-only confirm function that revalidates the
--     token, guards against Portal double-booking under an advisory lock,
--     applies the new time window, clears the no-show annotation, and consumes
--     the token — all in a single transaction.
--
-- Touches NOTHING existing: no status-enum change, no new table, no RLS policy
-- change, no anon/authenticated grant. The status vocabulary stays
-- ('scheduled','cancelled'); a no-show is an ANNOTATION, not a status.
--
-- NUMBERING: 0053.
-- ============================================================================

alter table public.meetings
  add column no_show_at                  timestamptz,
  add column no_show_followup_sent_at    timestamptz,
  add column reschedule_token_hash       text
    check (reschedule_token_hash is null or char_length(reschedule_token_hash) = 64),
  add column reschedule_token_expires_at timestamptz;

comment on column public.meetings.no_show_at is
  'Set when an admin marks the meeting a no-show. An ANNOTATION, not a status — excluded from the Google projection desired-state hash, so marking never writes to Google. Cleared when the meeting is rescheduled.';
comment on column public.meetings.no_show_followup_sent_at is
  'When the no-show follow-up email was sent (idempotency guard). Preserved as historical evidence even after a reschedule.';
comment on column public.meetings.reschedule_token_hash is
  'SHA-256 hex (64 chars) of the raw self-service reschedule token. The raw token exists only in the emailed URL; never stored. NULL = no active self-service link.';
comment on column public.meetings.reschedule_token_expires_at is
  'Expiry of the outstanding self-service reschedule token.';

-- A presented token hash resolves to at most one meeting; unlimited NULLs coexist.
create unique index meetings_reschedule_token_hash_key
  on public.meetings (reschedule_token_hash)
  where reschedule_token_hash is not null;

-- ── Atomic, single-use self-service reschedule ──────────────────────────────
-- Invoked ONLY by the service role (server-side, RLS-bypassing). SECURITY
-- INVOKER: it runs as service_role, so it bypasses RLS without a definer grant.
-- Reschedule keeps status='scheduled', so meetings_enforce_audit (0029) takes
-- its non-cancel UPDATE branch (stamps updated_at only; never calls auth.uid())
-- — correct under a caller with no authenticated user.
--
-- A no-show meeting is a VALID reschedule target: no_show_at is intentionally
-- NOT part of token resolution. On success the annotation is cleared so the
-- revived meeting returns to a clean scheduled state; no_show_followup_sent_at
-- is preserved as historical evidence.
create or replace function public.confirm_meeting_reschedule(
  p_token_hash text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_meeting_id uuid;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'invalid_slot' using errcode = 'P0001';
  end if;

  -- Serialize all self-service confirms so two tokens can't win the same slot.
  perform pg_advisory_xact_lock(hashtext('meetings_reschedule_slot')::bigint);

  -- Resolve + lock the meeting, validating the link is active, unexpired,
  -- not consumed, not cancelled, not deleted. (no_show_at is deliberately NOT
  -- checked — a no-show meeting is a valid reschedule target.)
  select id into v_meeting_id
  from public.meetings
  where reschedule_token_hash = p_token_hash
    and reschedule_token_expires_at > now()
    and status = 'scheduled'
    and deleted_at is null
  for update;

  if v_meeting_id is null then
    raise exception 'reschedule_link_invalid' using errcode = 'P0001';
  end if;

  -- Portal double-book guard: no OTHER active meeting overlaps the new slot.
  if exists (
    select 1 from public.meetings m
    where m.id <> v_meeting_id
      and m.status = 'scheduled'
      and m.deleted_at is null
      and tstzrange(m.starts_at, m.ends_at, '[)')
          && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  -- Apply the reschedule, clear the no-show annotation, and CONSUME the token.
  -- no_show_followup_sent_at is intentionally left as-is (historical evidence).
  update public.meetings
     set starts_at = p_starts_at,
         ends_at   = p_ends_at,
         no_show_at = null,
         reschedule_token_hash       = null,
         reschedule_token_expires_at = null
   where id = v_meeting_id;

  return v_meeting_id;
end;
$$;

revoke all on function public.confirm_meeting_reschedule(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_meeting_reschedule(text, timestamptz, timestamptz)
  to service_role;
