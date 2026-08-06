-- ============================================================================
-- Bbettr OS — Permanent ADMIN → agency-workspace binding (migration 0049).
--
-- Problem: a NEW admin profile is created by handle_new_user() (0001) with only
-- id/email/full_name/role/client_id — `workspace_id` is left NULL. Because
-- current_workspace_id() is fail-closed and every task-domain RLS policy ANDs
-- `workspace_id = current_workspace_id()`, a null-workspace admin has a completely
-- dead Planner (can't create tasks → NoWorkspace; every read returns zero rows;
-- absent from Team View). The 0036 backfill only fixed admins that existed then.
--
-- Fix (permanent, DB-only, path-independent): a BEFORE INSERT trigger on
-- public.profiles that binds the canonical agency workspace to every NEW admin
-- whose workspace_id is NULL, plus a one-time idempotent backfill for existing
-- null-workspace admins. It fires for EVERY profile-insert path (the
-- handle_new_user auth trigger and any direct insert), so no application change is
-- needed. handle_new_user, RLS, and the Inbox ownership model are untouched.
--
-- Guarantees (locked intent):
--   * New admin, workspace null            → bound to the agency workspace.
--   * Existing admin, workspace null       → backfilled (this migration).
--   * Existing admin, workspace already set→ NEVER overwritten (null guard).
--   * Client / rep                          → untouched (NULL), unchanged.
--   * Agency workspace missing              → FAIL CLOSED: leave NULL, and NEVER
--       raise — so profile creation (incl. clients/reps) is never blocked.
--   * No browser-supplied workspace_id is trusted (assignment is role-driven,
--       resolved server-side from workspaces.slug).
--
-- SECURITY: the trigger only ACTS on role='admin' — a self-registered account
-- cannot smuggle a workspace via metadata (workspace_id is never read from input;
-- it is resolved by the trusted unique slug). This binding is safe ONLY while
-- public sign-up is disabled (handle_new_user still trusts role from
-- raw_user_meta_data — see 0001 + README). Hardening role → app_metadata is a
-- separate, later phase.
--
-- Additive: one function + one trigger + one idempotent backfill. No table,
-- column, policy, or handle_new_user change. NUMBERING: 0049.
-- Prereq: 0001 (profiles, handle_new_user), 0036 (workspaces + seed + slug
-- 'bbettr-agency', profiles.workspace_id, current_workspace_id()).
-- ============================================================================

-- ── Assign function — resolve the agency workspace by its stable unique slug ──
create or replace function public.assign_admin_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  -- Only NEW admins that do not already carry a workspace. Clients/reps and any
  -- admin whose workspace is already set are left EXACTLY as-is (the null guard is
  -- what makes an existing binding impossible to overwrite).
  if new.role = 'admin' and new.workspace_id is null then
    -- Canonical agency workspace, resolved by the stable unique slug (never from
    -- caller input). SECURITY DEFINER lets this read workspaces regardless of the
    -- inserting role's RLS.
    select id into v_ws from public.workspaces where slug = 'bbettr-agency';
    -- FAIL CLOSED: if the agency workspace does not exist, leave workspace_id NULL
    -- (current_workspace_id() stays fail-closed). We deliberately do NOT raise —
    -- raising would block ALL profile creation, including clients and reps.
    if v_ws is not null then
      new.workspace_id := v_ws;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.assign_admin_workspace is
  'BEFORE INSERT on profiles: binds the canonical agency workspace (slug '
  '''bbettr-agency'') to a NEW admin whose workspace_id is NULL. Clients/reps and '
  'already-bound admins are untouched. Fail-closed (leaves NULL, never raises) if '
  'the agency workspace is missing. Role-driven only — no caller-supplied '
  'workspace_id is ever trusted.';

-- ── Trigger — fires for every profiles insert (auth-trigger path AND direct) ──
drop trigger if exists profiles_assign_admin_workspace on public.profiles;
create trigger profiles_assign_admin_workspace
  before insert on public.profiles
  for each row
  execute function public.assign_admin_workspace();

-- ── One-time idempotent backfill — existing admins with a NULL workspace ─────
-- Mirrors the 0036 backfill; the `exists` guard keeps it fail-closed (no-op when
-- the agency workspace is absent) and it never touches an admin that already has a
-- workspace, a client, or a rep.
update public.profiles
   set workspace_id = (select id from public.workspaces where slug = 'bbettr-agency')
 where role = 'admin'
   and workspace_id is null
   and exists (select 1 from public.workspaces where slug = 'bbettr-agency');

-- ── Rollback (manual) ────────────────────────────────────────────────────────
--   drop trigger if exists profiles_assign_admin_workspace on public.profiles;
--   drop function if exists public.assign_admin_workspace();
-- The backfilled workspace_id values remain (correct); no data is lost.
