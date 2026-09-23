-- ============================================================================
-- Bbettr OS — JARVIS FOUNDATION 1: security & execution boundary (0062).
--
-- The deterministic security kernel Jarvis will plug into. NO LLM, NO external
-- integrations, NO memory — this migration only creates the state the kernel
-- needs: capability grants, the protected-action (proposal/approval) store, and
-- an APPEND-ONLY action/audit log. All three live in the AGENCY workspace seam
-- (workspaces / current_workspace_id) — Jarvis is agency-internal and NEVER a
-- client/rep surface.
--
-- SECURITY POSTURE (locked by the approved Jarvis Security Contract):
--   • The Jarvis SYSTEM ACTOR is PROVENANCE, NOT AUTHORITY. It is a reserved
--     NON-LOGIN uuid (00000000-0000-0000-0000-00000000ja01 → written here as
--     0000…-000000004a01) used only to stamp `actor_kind='jarvis'`. It is NEVER
--     inserted into auth.users/profiles and can never authenticate. Authority
--     always comes from the authenticated human principal + capability grants +
--     deterministic policy + required approval + scope validation (enforced in
--     the application layer; these tables only STORE state).
--   • Grants are DATA (no founder email hardcoding) keyed by profiles.id, so a
--     future non-admin STAFF profile can hold narrow grants WITHOUT becoming a
--     Portal admin. The V1 read/manage UI is admin-only by route, but the model
--     does not require role='admin'.
--   • jarvis_action_events is APPEND-ONLY & IMMUTABLE (task_events pattern):
--     enable+force RLS, service_role limited to INSERT+SELECT, a reject-mutation
--     trigger on UPDATE/DELETE for EVERY role, admins may SELECT (agency ws).
--   • RLS is additive; client membership isolation (0060/0061) and Planner FORCE
--     RLS are untouched. No service-role op is exposed to authenticated/browser.
--
-- Prereqs: 0001 (profiles, is_admin), 0036 (workspaces, current_workspace_id).
-- Additive only. Idempotent guards; the migration runner applies once.
-- ============================================================================

-- ── Capability grants (workspace-scoped; assignable to ANY profile) ──────────
-- grant_key is either a capability id ('jarvis.use', 'portal.read', …) or a
-- bundle marker ('bundle:founder'); bundles are expanded in application code.
-- Default-deny: absence of a row = no capability. Writes are service-role only
-- (a privileged, audited admin action); clients can never see or write these.
create table if not exists public.jarvis_capability_grants (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  grant_key       text not null check (char_length(trim(grant_key)) > 0 and char_length(grant_key) <= 100),
  granted_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint jarvis_grants_unique unique (workspace_id, subject_user_id, grant_key)
);
create index if not exists jarvis_grants_subject_idx
  on public.jarvis_capability_grants (workspace_id, subject_user_id);

alter table public.jarvis_capability_grants enable row level security;
grant select on public.jarvis_capability_grants to authenticated;
grant all    on public.jarvis_capability_grants to service_role;
-- Admins read grants in THEIR agency workspace (V1 admin-only surface); no
-- client/rep visibility. No authenticated write policy → only service_role
-- (the privileged, audited grant-management path) may mutate.
drop policy if exists "Admins read jarvis grants" on public.jarvis_capability_grants;
create policy "Admins read jarvis grants"
  on public.jarvis_capability_grants for select to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- ── Protected-action proposals / approvals ──────────────────────────────────
-- The confirm-required flow: propose → pending → approve/reject → execute. The
-- EXACT proposed effect + its hash are stored so approval binds to specific
-- content; execution re-validates hash + freshness + single-use.
create table if not exists public.jarvis_proposals (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id),
  capability_id        text not null,
  args                 jsonb not null default '{}'::jsonb,
  effect               jsonb not null default '{}'::jsonb,
  effect_hash          text not null,
  rationale            text,
  status               text not null default 'pending'
                         check (status in ('pending','approved','rejected','executed','failed','expired')),
  -- The human principal who initiated (nullable for a proactive Jarvis proposal).
  initiated_by         uuid references public.profiles (id) on delete set null,
  is_proactive         boolean not null default false,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  approved_by          uuid references public.profiles (id) on delete set null,
  approved_at          timestamptz,
  rejected_by          uuid references public.profiles (id) on delete set null,
  rejected_at          timestamptz,
  executed_at          timestamptz,
  idempotency_key      text unique,
  verification_state   text not null default 'not_required'
                         check (verification_state in ('not_required','pending','reported','verified','failed','unavailable')),
  verification_evidence jsonb,
  error                text
);
create index if not exists jarvis_proposals_status_idx
  on public.jarvis_proposals (workspace_id, status, created_at desc);

alter table public.jarvis_proposals enable row level security;
grant select on public.jarvis_proposals to authenticated;
grant all    on public.jarvis_proposals to service_role;
drop policy if exists "Admins read jarvis proposals" on public.jarvis_proposals;
create policy "Admins read jarvis proposals"
  on public.jarvis_proposals for select to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- ── Append-only action / audit log (task_events discipline) ──────────────────
create table if not exists public.jarvis_action_events (
  event_id           uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,
  workspace_id       uuid not null references public.workspaces (id),
  occurred_at        timestamptz not null default now(),
  actor_kind         text not null check (actor_kind in ('jarvis','human','system')),
  initiated_by       uuid references public.profiles (id) on delete set null,
  is_proactive       boolean not null default false,
  capability_id      text not null,
  decision           text not null check (decision in ('allow','deny','needs_approval','monitor_only')),
  risk_class         text,
  target_client_id   uuid references public.clients (id) on delete set null,
  proposal_id        uuid references public.jarvis_proposals (id) on delete set null,
  approval_by        uuid references public.profiles (id) on delete set null,
  executed           boolean not null default false,
  success            boolean,
  verification_state text,
  evidence           jsonb,
  sources            jsonb,
  idempotency_key    text,
  error              text,
  detail             jsonb
);
create index if not exists jarvis_action_events_ws_idx
  on public.jarvis_action_events (workspace_id, occurred_at desc);

alter table public.jarvis_action_events enable row level security;
alter table public.jarvis_action_events force row level security;
-- Append-only: service_role may INSERT+SELECT only; admins may SELECT (agency
-- workspace). NOBODY may UPDATE/DELETE (privileges + trigger both enforce).
revoke all on public.jarvis_action_events from anon;
revoke all on public.jarvis_action_events from authenticated;
revoke all on public.jarvis_action_events from service_role;
grant insert, select on public.jarvis_action_events to service_role;
grant select on public.jarvis_action_events to authenticated;
drop policy if exists "Admins read jarvis actions" on public.jarvis_action_events;
create policy "Admins read jarvis actions"
  on public.jarvis_action_events for select to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

create or replace function public.jarvis_action_events_reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'jarvis_action_events is append-only (%.% rejected)', tg_op, tg_table_name;
end;
$$;
drop trigger if exists jarvis_action_events_no_mutation on public.jarvis_action_events;
create trigger jarvis_action_events_no_mutation
  before update or delete on public.jarvis_action_events
  for each row execute function public.jarvis_action_events_reject_mutation();
