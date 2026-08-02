-- ============================================================================
-- Bbettr OS — Planner Tasks: task_reminders (B4, migration 0042).
--
-- Reminder INTENT + engine state (see schema-and-migration-spec.md §12, §18–§19;
-- persistence-architecture.md §11). A reminder is a nudge attached to a task, not
-- the task itself. This is a SERVICE-ROLE-ONLY engine/plumbing table — the exact
-- posture of calendar_projections (0031): RLS enabled+forced with NO policies,
-- reachable only by trusted server code using the service role.
--
-- STRICT SCOPE — this migration stores reminder intent + engine state ONLY: the
-- table, its CHECKs/FK/indexes, and service-role RLS/grants.
--
-- OUT OF SCOPE (built later): the temporal evaluator (pending->due), claiming/
-- single-flight delivery, retry orchestration, the delivery service, the
-- ReminderDue event (0043), notification-provider integration, any safe
-- admin-intent read model (0047), and persistence RPCs/services/APIs/UI. This
-- migration changes NO task lifecycle state and touches no other table.
--
-- Provider-neutral: NO provider payloads/tokens/config are stored. last_error
-- holds a SANITIZED code only (length-capped), never a raw provider response.
-- Human users never mutate engine state (no authenticated policy). Clients, reps
-- and anon have zero access. No reminder may cross a workspace boundary.
--
-- NUMBERING: 0042. Prereq: 0037 (tasks + the (workspace_id,id) composite anchor).
-- ============================================================================

create table if not exists public.task_reminders (
  id            uuid not null default gen_random_uuid(),
  workspace_id  uuid not null,
  task_id       uuid not null,

  remind_at     timestamptz not null,     -- when to fire
  state         text not null default 'pending',

  dedupe_key    text,                      -- provider-neutral idempotency
  claimed_at    timestamptz,               -- single-flight lock (with claim_token)
  claim_token   uuid,                      -- a worker releases only its own claim
  delivered_at  timestamptz,
  attempts      integer not null default 0,
  last_error    text,                      -- SANITIZED code only (never provider bodies)
  created_at    timestamptz not null default now(),

  constraint task_reminders_pkey primary key (id),

  -- Same-workspace: a reminder's task must live in the reminder's workspace.
  constraint task_reminders_task_fk
    foreign key (workspace_id, task_id)
    references public.tasks (workspace_id, id),

  -- Value domains + lifecycle consistency (all fully null-safe → TRUE/FALSE only;
  -- state is NOT NULL).
  constraint task_reminders_state_valid
    check (state in ('pending','due','delivered','cancelled')),
  constraint task_reminders_attempts_nonneg
    check (attempts >= 0),
  -- delivered iff delivered_at is set (so cancelled/pending/due all have it null).
  constraint task_reminders_delivered_consistency
    check ((state = 'delivered') = (delivered_at is not null)),
  -- Single-flight lock: claimed_at and claim_token move together. The claim is a
  -- transient lock, orthogonal to state (calendar_projections lock model).
  constraint task_reminders_claim_pairing
    check ((claimed_at is null) = (claim_token is null)),
  -- Sanitized error only: a modest length cap discourages storing raw provider
  -- responses (true sanitization is the delivery service's responsibility).
  constraint task_reminders_last_error_len
    check (last_error is null or char_length(last_error) <= 200)
);

comment on table public.task_reminders is
  'Reminder intent + engine state (SERVICE-ROLE ONLY). A nudge attached to a '
  'task; delivery is external. Provider-neutral: no payloads/tokens; last_error '
  'is a sanitized code only. Reachable only by trusted server code (service_role).';

-- ── Idempotency ──────────────────────────────────────────────────────────────
-- Permanent, workspace-scoped dedupe key: a replayed idempotent request never
-- creates a duplicate (independent of any TTL).
create unique index if not exists task_reminders_dedupe_key_idx
  on public.task_reminders (workspace_id, dedupe_key)
  where dedupe_key is not null;

-- At most ONE ACTIVE reminder per (task, instant). Terminal reminders
-- (delivered/cancelled) are retained and do NOT block a new reminder at the same
-- instant (active-only, consistent with the 0038/0039 uniqueness pattern).
create unique index if not exists task_reminders_active_instant_idx
  on public.task_reminders (task_id, remind_at)
  where state in ('pending','due');

-- ── Evaluator index (per §19) ───────────────────────────────────────────────
-- The temporal evaluator's pending-scan work queue.
create index if not exists task_reminders_pending_idx
  on public.task_reminders (state, remind_at) where state = 'pending';

-- ── Row Level Security — SERVICE-ROLE ONLY (calendar_projections posture) ────
alter table public.task_reminders enable row level security;
alter table public.task_reminders force row level security;

-- Intentionally NO policies: every anon/authenticated request is denied,
-- including admins. Only service_role (secret key, bypasses RLS) reaches it.
-- A safe admin-intent read model, if ever needed, is a 0047 concern.

revoke all on public.task_reminders from anon;
revoke all on public.task_reminders from authenticated;
grant all  on public.task_reminders to service_role;
