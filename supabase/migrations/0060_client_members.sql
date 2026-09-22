-- ============================================================================
-- Bbettr OS — Multi-Workspace Membership, S1 FOUNDATION (migration 0060).
--
-- Introduces a secure many-to-many link between portal users (auth.users) and
-- client workspaces (clients), ALONGSIDE the existing scalar profiles.client_id:
--
--     auth.users ─┐
--                 ├─< client_members >─┐
--     clients  ───┘                    └─ role (workspace-level)
--
-- S1 IS FOUNDATION ONLY. It is strictly ADDITIVE and BEHAVIOUR-PRESERVING:
--   • NOTHING reads client_members for authorization or active-workspace
--     resolution yet — current_client_id() and every existing tenant RLS policy
--     are left EXACTLY as they are. The current portal keeps resolving through
--     profiles.client_id (0001/0002). Wiring tenant RLS to membership is S2.
--   • profiles.client_id is untouched (kept intact).
--   • No workspace switcher / account selector / UI — the table lives invisibly
--     beneath the current app.
--
-- The new table is secured from day one, memberships are kept in sync with
-- provisioning GOING FORWARD, and every existing client-role relationship is
-- backfilled as an equivalent membership.
--
-- Prereqs: 0001 (clients, profiles, is_admin, auth.users), 0002 (RLS baseline).
-- Additive: creates client_members (+ its RLS/grants), one helper function, one
-- profiles sync trigger, and a one-time backfill. No existing object is altered.
-- Idempotency: the migration is written to be safe to re-run (guards + ON
-- CONFLICT); the standard migration runner still applies it exactly once.
-- ============================================================================

-- ── Membership table ────────────────────────────────────────────────────────
-- Surrogate uuid PK (repo convention: every table has an `id`), with a natural
-- uniqueness guarantee on (user_id, client_id) so a user can never hold two
-- membership rows for the same workspace.
--
-- Delete behaviour (deliberate):
--   • user_id  → auth.users ON DELETE CASCADE — mirrors profiles.id, which is
--     itself `references auth.users(id) on delete cascade`. If the login is
--     removed, its memberships are meaningless and go with it.
--   • client_id → clients ON DELETE CASCADE — matches every other tenant-scoped
--     table (client_services, project_stages, updates, …). A membership only has
--     meaning while its workspace exists; NOT NULL means SET NULL isn't an option
--     and a dangling half-membership must never survive. (profiles.client_id uses
--     SET NULL because a PROFILE must outlive its tenant — e.g. an admin, or a
--     user awaiting reassignment; a membership row has no such standalone role.)
--
-- role: workspace-level membership role — a DIFFERENT concept from the global
-- profiles.role ('admin'/'client'/…), which is untouched. S1 needs only a plain
-- membership, so the sole value is 'member'; the CHECK can be widened later
-- (e.g. 'owner'/'editor'/'viewer') without a permissions system today.
create table client_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  uuid not null references clients(id)    on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  constraint client_members_user_client_key unique (user_id, client_id),
  constraint client_members_role_check check (role in ('member'))
);

-- Membership lookups. "Which members belong to this workspace?" wants client_id;
-- "which workspaces does this user belong to?" is already served by the
-- (user_id, client_id) UNIQUE index (user_id is its leading column).
create index client_members_client_id_idx on client_members(client_id);

-- Base privileges (RLS still constrains the rows — see policies below). Matches
-- the per-table grant convention used across the schema.
grant select, insert, update, delete on public.client_members to authenticated;

-- ── RLS — secure from day one ───────────────────────────────────────────────
alter table client_members enable row level security;

-- Admins (existing global is_admin()) manage all memberships — the only write
-- path for end users, and how the future Admin Access slice will grant/revoke.
create policy "Admins manage all memberships"
  on client_members for all
  using (is_admin())
  with check (is_admin());

-- A user may READ only their OWN memberships, and nothing else. There is NO
-- client insert/update/delete policy, so a non-admin client can never create,
-- move or delete a membership — they cannot grant themselves another workspace,
-- reassign a membership, or enumerate other users'/workspaces' memberships.
-- Uses auth.uid() directly (never current_client_id() or is_client_member()),
-- so it stays minimal and cannot recurse on this very table.
create policy "Users read own memberships"
  on client_members for select
  to authenticated
  using (user_id = auth.uid());

-- ── Future-facing helper (defined now, WIRED TO NOTHING in S1) ───────────────
-- Mirrors is_admin()/current_client_id(): SECURITY DEFINER + pinned search_path,
-- STABLE. It answers "is the caller a member of this client?" for S1 tests and
-- the S2 tenant-RLS migration, so that logic isn't duplicated later. It is NOT
-- referenced by ANY policy in S1 — in particular NOT by client_members' own
-- policies — so no existing authorization changes and there is no RLS recursion.
create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.client_members
    where user_id = auth.uid() and client_id = target_client_id
  );
$$;

comment on function public.is_client_member(uuid) is
  'S1 membership primitive: true when the JWT user has a client_members row for '
  'the given client. SECURITY DEFINER + pinned search_path, STABLE. Introduced '
  'for S1 tests and the future S2 tenant-RLS migration; NOT wired to any policy '
  'in S1 (current_client_id() still powers all tenant authorization).';

-- ── Keep memberships in sync with provisioning, GOING FORWARD ────────────────
-- We do NOT redesign provisioning: handle_new_user() and the admin create-client
-- flow are untouched. Instead, whenever a profile is created OR its client_id/
-- role is (re)assigned by a trusted path, the equivalent membership is mirrored
-- in. This guarantees new clients created tomorrow get memberships too — not just
-- the historical backfill — with zero change to login/resolution behaviour.
--
-- SECURITY DEFINER (runs as the table owner) so the mirror write succeeds
-- regardless of the caller's RLS, with a pinned search_path. Idempotent via ON
-- CONFLICT. It only ever mirrors what is ALREADY on the profile — it never
-- grants access the profile doesn't already imply. Untrusted end-user updates
-- are already prevented from changing client_id/role by the 0050 guard, so this
-- fires meaningfully only for trusted (admin/service/migration) writes.
create or replace function public.sync_client_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'client' and new.client_id is not null then
    insert into public.client_members (user_id, client_id, role)
    values (new.id, new.client_id, 'member')
    on conflict (user_id, client_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.sync_client_membership is
  'AFTER INSERT/UPDATE-of-(client_id,role) on profiles: mirrors a client-role '
  'profile with a non-null client_id into an equivalent client_members row '
  '(idempotent). Keeps membership provisioning in sync going forward without '
  'changing handle_new_user, login, or active-workspace resolution.';

drop trigger if exists profiles_sync_client_membership on public.profiles;
create trigger profiles_sync_client_membership
  after insert or update of client_id, role on public.profiles
  for each row execute function public.sync_client_membership();

-- ── Backfill: preserve every existing relationship as a membership ───────────
-- Deterministic and idempotent. Every profile that currently authorizes into a
-- workspace (role = 'client' AND client_id IS NOT NULL) receives the equivalent
-- membership. profiles/clients are NOT altered and nobody is attached to any
-- ADDITIONAL workspace — this only re-expresses the CURRENT relationship.
insert into public.client_members (user_id, client_id, role)
select p.id, p.client_id, 'member'
from public.profiles p
where p.role = 'client'
  and p.client_id is not null
on conflict (user_id, client_id) do nothing;
