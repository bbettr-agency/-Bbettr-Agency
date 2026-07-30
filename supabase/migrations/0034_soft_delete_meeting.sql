-- ============================================================================
-- Bbettr OS — guarded soft-delete for meetings (RLS-safe).
--
-- Why this exists (proven root cause):
--   A soft-delete is `UPDATE meetings SET deleted_at = now()`. PostgreSQL applies
--   the SELECT policy's USING expression to the NEW row of an UPDATE — a row may
--   not be updated into a state where the updater can no longer see it. The
--   SELECT policy `meetings_select_admin USING (is_admin() AND deleted_at IS NULL)`
--   therefore rejects the soft-deleted row with SQLSTATE 42501 ("new row violates
--   row-level security policy for table meetings"). is_admin() and the UPDATE
--   policy both pass; the failure is purely the SELECT-visibility rule.
--
-- Fix: perform the soft-delete through a SECURITY DEFINER function that
--   re-verifies is_admin() itself. Definer rights bypass the RLS visibility rule
--   for this one guarded operation WITHOUT weakening any policy and WITHOUT the
--   application using the service-role client. The SELECT policy is untouched, so
--   deleted rows stay hidden from normal reads.
--
-- Additive: one function. No table/policy changes. NUMBERING: 0034.
-- ============================================================================

create or replace function public.soft_delete_meeting(p_meeting_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Authorization is enforced INSIDE the function: is_admin() reads auth.uid()
  -- from the caller's JWT (unchanged by SECURITY DEFINER), so a non-admin caller
  -- is rejected with a sanitized error — never any row data.
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Soft-delete ONLY a live (not-yet-deleted) meeting; never a hard delete. The
  -- meetings_enforce_audit trigger still fires (stamps updated_at, keeps
  -- created_by/created_at immutable). Returns the id when a live row was
  -- affected; NULL when the meeting is missing OR already deleted — a
  -- deterministic, idempotent no-op that leaks no hidden row data.
  update public.meetings
     set deleted_at = now()
   where id = p_meeting_id
     and deleted_at is null
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.soft_delete_meeting is
  'Admin-only soft delete of a meeting (SECURITY DEFINER; re-checks is_admin()). Sets deleted_at on a live row only; idempotent (NULL when missing/already deleted). Keeps the SELECT visibility policy intact — no service-role, no hard delete.';

-- ── Least-privilege execution ───────────────────────────────────────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default — lock that down first.
revoke all on function public.soft_delete_meeting(uuid) from public;
revoke all on function public.soft_delete_meeting(uuid) from anon;
grant execute on function public.soft_delete_meeting(uuid) to authenticated;

-- The function owner is the role that applies this migration (in Supabase, the
-- trusted `postgres` role), which is what lets SECURITY DEFINER bypass the RLS
-- visibility rule. Authorization is still enforced by the is_admin() check above.
