-- ============================================================================
-- Bbettr OS — atomic meeting creation (meeting + attendees in one transaction).
--
-- Phase 3.1 hardening. Replaces the two sequential auto-committed inserts in the
-- create action with a single SECURITY INVOKER function, so meeting + attendees
-- either both commit or neither does.
--
-- SECURITY INVOKER: the function runs as the CALLING role (authenticated), so
-- the meetings_insert_admin RLS check and the meetings_enforce_audit trigger
-- still apply exactly as for a direct insert — created_by is stamped from
-- auth.uid(), and a non-admin cannot create a meeting. A PL/pgSQL function body
-- is one transaction: any failure (including the idempotency unique-violation)
-- rolls back the whole thing.
--
-- Additive: one function. Touches no table. NUMBERING: 0033.
-- ============================================================================

create or replace function public.create_meeting_with_attendees(
  p_title           text,
  p_description     text,
  p_starts_at       timestamptz,
  p_ends_at         timestamptz,
  p_time_zone       text,
  p_has_meet        boolean,
  p_idempotency_key text,
  p_attendees       jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.meetings
    (title, description, starts_at, ends_at, time_zone, has_meet, idempotency_key)
  values
    (p_title, p_description, p_starts_at, p_ends_at, p_time_zone, p_has_meet, p_idempotency_key)
  returning id into v_id;

  if p_attendees is not null and jsonb_array_length(p_attendees) > 0 then
    insert into public.meeting_attendees (meeting_id, email, display_name)
    select
      v_id,
      (a ->> 'email'),
      nullif(a ->> 'display_name', '')
    from jsonb_array_elements(p_attendees) as a
    where coalesce(a ->> 'email', '') <> '';
  end if;

  return v_id;
end;
$$;

comment on function public.create_meeting_with_attendees is
  'Atomically create a meeting and its attendees (Phase 3.1). SECURITY INVOKER: RLS + audit trigger apply; the whole call rolls back on any failure (incl. idempotency-key conflict).';

revoke all on function public.create_meeting_with_attendees(
  text, text, timestamptz, timestamptz, text, boolean, text, jsonb
) from anon;
grant execute on function public.create_meeting_with_attendees(
  text, text, timestamptz, timestamptz, text, boolean, text, jsonb
) to authenticated;
