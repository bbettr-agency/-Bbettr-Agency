-- ============================================================================
-- Bbettr OS — SECURITY PATCH: guard privileged profile columns (migration 0050).
--
-- CONFIRMED VULNERABILITY (pre-existing, independent of 0049): the RLS policy
-- `Users update own profile` (0002) is `using (id = auth.uid()) with check
-- (id = auth.uid())` — it pins only the row id, NOT the privileged columns — and
-- no trigger protects them. Combined with the default column grants, ANY
-- authenticated client/rep could, straight from the browser:
--     update profiles set role='admin', client_id='<other tenant>',
--                         workspace_id='00000000-…-001' where id = auth.uid();
-- i.e. self-promote to admin (role → is_admin()), cross into another tenant
-- (client_id → current_client_id()), and join the agency workspace
-- (workspace_id → current_workspace_id()). This patch closes that hole.
--
-- FIX: a BEFORE UPDATE trigger on public.profiles that holds role / client_id /
-- workspace_id to their OLD values for UNTRUSTED end-user updaters, while leaving
-- every legitimate flow intact. Mirrors the existing tasks_enforce_audit
-- immutable-field idiom. UPDATE-only; INSERT flows (handle_new_user, 0049) are
-- untouched; no data is rewritten.
--
-- WHO IS "UNTRUSTED": the PostgREST end-user roles `authenticated` and `anon`.
-- Empirically verified in the DB harness (set local role authenticated /
-- service_role / anon; postgres for migrations) that `current_user` is the
-- reliable discriminator:
--     end user      → current_user = 'authenticated'   (guarded, unless admin)
--     anon          → current_user = 'anon'             (guarded)
--     service role  → current_user = 'service_role'     (NOT guarded)
--     migration/CLI → current_user = 'postgres'         (NOT guarded)
-- SECURITY INVOKER is REQUIRED so current_user reflects the CALLER (a definer
-- function would report the owner and defeat the check). is_admin() is itself
-- SECURITY DEFINER, so admins are recognised regardless.
--
-- Preserves: name/avatar edits (non-privileged columns are never held); admin
-- privileged updates (is_admin() bypass — the 'Admins manage profiles' policy);
-- service-role operations; client/rep onboarding + sign-in + profile creation
-- (all INSERT, unaffected). Idempotent (create-or-replace + drop/create trigger).
--
-- Additive, DB-only. No table/column/policy/grant change; handle_new_user, RLS,
-- 0049 and the Inbox model are untouched. NUMBERING: 0050.
-- Prereq: 0001 (profiles, is_admin), 0002 (RLS), 0036 (workspace_id column).
-- ============================================================================

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security invoker            -- MUST be invoker: current_user must reflect the caller
set search_path = public
as $$
begin
  -- An end user (authenticated/anon) editing a profile may change only
  -- non-privileged fields (full_name, avatar_url, …). The three authorization/
  -- tenancy columns are held to their OLD values, so a crafted update silently
  -- no-ops on them rather than being rejected — legitimate edits still succeed.
  -- Admins (is_admin()), the service role, and the migration/dashboard superuser
  -- are NOT end-user roles and retain full control.
  --
  -- WHY THE UNTRUSTED SET {authenticated, anon} IS EXHAUSTIVE: a browser/JWT
  -- caller reaches the DB only through PostgREST's `authenticator`, which SET
  -- ROLEs to exactly one of anon / authenticated / service_role based on the
  -- SIGNED (unforgeable) JWT `role` claim. service_role is trusted; every other
  -- role (postgres, supabase_admin, authenticator, …) is internal/privileged.
  -- So an untrusted external caller is ALWAYS current_user='authenticated' or
  -- 'anon'. An allowlist is used deliberately — a deny-by-default list would have
  -- to enumerate every internal role and would fail-CLOSED (break migrations / RI
  -- cascades) if one were missed. ⚠️ MAINTENANCE: if a future custom DB role that
  -- a JWT can assume AND that holds UPDATE on public.profiles is ever added, add
  -- it here.
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    new.role         := old.role;
    new.client_id    := old.client_id;
    new.workspace_id := old.workspace_id;
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns is
  'BEFORE UPDATE guard: holds role/client_id/workspace_id to OLD for untrusted '
  'end-user roles (authenticated/anon, non-admin); admins, service_role and the '
  'superuser retain full control. SECURITY INVOKER so current_user is the caller. '
  'Closes the profiles self-promotion / cross-tenant escalation. UPDATE-only.';

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privileged_columns();

-- ── Rollback (manual) ────────────────────────────────────────────────────────
--   drop trigger if exists profiles_guard_privileged_columns on public.profiles;
--   drop function if exists public.profiles_guard_privileged_columns();
-- No data was written; fully reversible.
