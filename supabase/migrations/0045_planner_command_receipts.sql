-- ============================================================================
-- Bbettr OS — Planner Tasks: command_receipts (B4, migration 0045).
--
-- SUCCESS-ONLY command idempotency receipts (see schema-and-migration-spec.md
-- §15, persistence-architecture.md §13). A receipt exists IFF its command
-- committed. This is a MUTABLE, SERVICE-ROLE-ONLY engine table (the
-- calendar_projections posture) — service_role has full CRUD, including DELETE
-- for the future TTL sweep on expires_at.
--
-- STRICT SCOPE — this migration creates the table + its constraints/indexes +
-- service-role RLS ONLY.
--
-- OUT OF SCOPE (built later): the atomic persistence operation (0046) that
-- writes a receipt IN THE SAME TRANSACTION as task state + ordered events; the
-- replay-lookup / conflict-detection / no-op semantics; the periodic TTL sweep
-- job; and any repositories/services/APIs/automations/UI. This migration
-- implements NO logic, writes NO events, changes NO task state, and adds NO FK
-- to profiles/tasks/events or any receipt target, and NO triggers.
--
-- Idempotency behaviour realised LATER by the op (not here): same key + same
-- payload_hash -> the stored successful outcome is returned (a `replayed` result,
-- which is RETURN-ONLY and NEVER inserted as a row); same key + different
-- payload_hash -> IdempotencyConflict; failures/rollbacks leave no receipt and
-- stay retryable. Permanent business idempotency keys (recurrence
-- (recurrence_definition_id, occurrence_slot), external natural keys) live on
-- their own tables, NOT here.
--
-- NUMBERING: 0045. Prereq: 0036 (workspaces).
-- ============================================================================

create table if not exists public.command_receipts (
  id                       uuid not null default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces (id),
  idempotency_key          text not null,
  command_type             text not null,
  payload_hash             text not null,

  -- Actor context (loose metadata; plain columns, NO FK — receipts are ephemeral
  -- engine plumbing and must not couple to the profile lifecycle).
  actor_kind               text,
  actor_user_id            uuid,
  actor_ref                text,

  -- Outcome pointers (plain columns, NO FK — a temporary pointer to the affected
  -- task; must not couple TTL receipts to the permanent tasks lifecycle).
  result_task_id           uuid,
  result_aggregate_version integer,

  -- Success-only outcomes. `replayed` is a RETURN-ONLY application result and is
  -- NEVER stored here; failures/conflicts create no receipt at all.
  outcome                  text not null,

  created_at               timestamptz not null default now(),
  expires_at               timestamptz not null default (now() + interval '30 days'),

  constraint command_receipts_pkey primary key (id),

  -- Workspace-scoped idempotency key (replay lookup + conflict detection).
  constraint command_receipts_workspace_key_unique unique (workspace_id, idempotency_key),

  -- Value domains + structural guards (all fully null-safe → TRUE/FALSE only).
  constraint command_receipts_outcome_valid
    check (outcome in ('applied','accepted_noop')),
  constraint command_receipts_idempotency_key_nonempty
    check (char_length(trim(idempotency_key)) > 0),
  constraint command_receipts_command_type_nonempty
    check (char_length(trim(command_type)) > 0),
  constraint command_receipts_payload_hash_nonempty
    check (char_length(trim(payload_hash)) > 0),
  constraint command_receipts_expires_after_created
    check (expires_at >= created_at),
  -- Actor-kind consistency (nullable actor context). NB: `is not distinct from`
  -- (not `=`) so a NULL actor_kind yields FALSE, not NULL — otherwise a CHECK
  -- treats NULL as passing and a stray actor_user_id/actor_ref with no
  -- actor_kind would be wrongly accepted. A user id only on 'user' context; an
  -- actor_ref only on 'automation'/'system' context.
  constraint command_receipts_actor_kind_valid
    check (actor_kind is null or actor_kind in ('user','automation','system')),
  constraint command_receipts_actor_user_id_only_user
    check (actor_user_id is null or actor_kind is not distinct from 'user'),
  constraint command_receipts_actor_ref_not_user
    check (actor_ref is null
           or actor_kind is not distinct from 'automation'
           or actor_kind is not distinct from 'system')
);

comment on table public.command_receipts is
  'Success-only command idempotency receipts (MUTABLE, SERVICE-ROLE only). A '
  'receipt exists iff its command committed; stored outcomes are applied or '
  'accepted_noop. replayed is return-only (never a row); failures/conflicts '
  'create no receipt. TTL-swept on expires_at. No FKs — ephemeral engine plumbing.';

-- ── RLS — service-role only, MUTABLE (full CRUD incl. DELETE for TTL sweep) ──
alter table public.command_receipts enable row level security;
alter table public.command_receipts force row level security;

-- Intentionally NO policies: anon/authenticated (incl. admins) are denied.
revoke all on public.command_receipts from anon;
revoke all on public.command_receipts from authenticated;
grant all  on public.command_receipts to service_role;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- (The unique constraint already provides the (workspace_id, idempotency_key)
-- lookup index.) Expiry index for the future TTL sweep.
create index if not exists command_receipts_expires_idx
  on public.command_receipts (expires_at);
