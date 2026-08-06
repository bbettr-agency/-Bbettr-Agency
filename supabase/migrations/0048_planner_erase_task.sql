-- ============================================================================
-- Bbettr OS — Planner Tasks: guarded ERASE (permanent removal from all views).
--
-- Product need: an admin must be able to DELETE a task completely — not archive
-- it (Drop → status 'archived', still reportable/visible in history) but remove
-- it from EVERY view, permanently, unrecoverable through the Portal.
--
-- The tasks aggregate was purpose-built for this: `tasks.deleted_at` is reserved
-- for "exceptional erasure only (never Drop/Cancel)" (0037, column comment), and
-- the SELECT RLS policy already excludes any row with `deleted_at is not null`.
-- Setting deleted_at therefore makes a task vanish from all reads at once. The
-- immutable append-only audit trail (task_events) is intentionally LEFT INTACT:
-- an invisible forensic row remains for integrity, but nothing surfaces it to any
-- Portal read. This is NOT a physical row DELETE and does not cascade.
--
-- Why a SECURITY DEFINER function (mirrors 0034 soft_delete_meeting):
--   A plain `UPDATE tasks SET deleted_at = now()` is rejected by RLS. PostgreSQL
--   applies the SELECT policy's USING expression to the NEW row of an UPDATE — a
--   row may not be updated into a state where the updater can no longer see it.
--   `tasks_select_admin USING (... AND deleted_at IS NULL)` rejects the erased
--   row with SQLSTATE 42501. The fix is a SECURITY DEFINER function that
--   re-verifies is_admin() itself; definer rights bypass the visibility rule for
--   this one guarded operation WITHOUT weakening any policy and WITHOUT the
--   application using the service-role client. The SELECT policy is untouched.
--
-- Authorization is enforced INSIDE the function (is_admin() reads auth.uid() from
-- the caller's JWT — unchanged by SECURITY DEFINER) and the target is scoped to
-- the caller's own workspace via current_workspace_id(), so a non-admin, or an
-- admin from another workspace, is a deterministic no-op that leaks no row data.
--
-- Additive: one function. No table/policy/column changes. NUMBERING: 0048.
-- Prereq: 0037 (public.tasks, deleted_at, RLS), 0036 (current_workspace_id()).
-- ============================================================================

create or replace function public.erase_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Authorization is enforced here: is_admin() reads auth.uid() from the caller's
  -- JWT (SECURITY DEFINER does not change the session user), so a non-admin caller
  -- is rejected with a sanitized error — never any row data.
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Erase ONLY a live (not-yet-erased) task IN THE CALLER'S OWN WORKSPACE. The
  -- workspace scope means an admin can never erase another workspace's task, even
  -- by guessing an id. The tasks_enforce_audit trigger still fires (stamps
  -- updated_at; holds id/workspace/created_at/created_by immutable). Returns the
  -- id when a live row was affected; NULL when the task is missing, already
  -- erased, or outside the workspace — a deterministic, idempotent no-op that
  -- leaks no hidden row data.
  update public.tasks
     set deleted_at = now()
   where id = p_task_id
     and workspace_id = public.current_workspace_id()
     and deleted_at is null
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.erase_task is
  'Admin-only permanent erase of a task (SECURITY DEFINER; re-checks is_admin(); '
  'workspace-scoped). Sets deleted_at on a live row only so the task disappears '
  'from every view; idempotent (NULL when missing/already erased/out-of-workspace). '
  'Leaves the append-only audit trail intact. Not a physical DELETE; no cascade. '
  'Keeps the SELECT visibility policy untouched — no service-role, no hard delete.';

-- ── Least-privilege execution ───────────────────────────────────────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default — lock that down first.
revoke all on function public.erase_task(uuid) from public;
revoke all on function public.erase_task(uuid) from anon;
grant execute on function public.erase_task(uuid) to authenticated;

-- The function owner is the role that applies this migration (in Supabase, the
-- trusted `postgres` role), which is what lets SECURITY DEFINER bypass the RLS
-- visibility rule. Authorization is still enforced by the is_admin() check above.
