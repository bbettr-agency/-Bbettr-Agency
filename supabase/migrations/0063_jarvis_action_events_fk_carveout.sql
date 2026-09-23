-- ============================================================================
-- Bbettr OS — JARVIS FOUNDATION 1 hardening (0063): append-only FK carve-out.
--
-- ADDITIVE, code-safe correction. It does NOT edit 0062 (already applied in
-- production); it only CREATE OR REPLACEs the append-only guard function that
-- 0062 installed on public.jarvis_action_events, and re-affirms the trigger.
--
-- DEFECT (confirmed against the real schema):
--   jarvis_action_events has FOUR `on delete set null` foreign keys:
--     initiated_by  -> profiles(id)
--     approval_by   -> profiles(id)
--     target_client_id -> clients(id)
--     proposal_id   -> jarvis_proposals(id)
--   PostgreSQL implements `on delete set null` by issuing an UPDATE against the
--   referencing row, which fires BEFORE UPDATE row triggers. 0062's guard
--   rejects EVERY update unconditionally, so deleting a referenced profile
--   (e.g. via auth.users ON DELETE CASCADE -> profiles), client, or proposal
--   would fire the guard and ABORT the delete. Result: a user/client/proposal
--   that was ever referenced by a Jarvis action event could not be deleted.
--
-- FIX (the proven task_events (0043) discipline, generalised to the 4 FK cols):
--   Permit ONLY the exact FK-driven nullification — an UPDATE where every
--   protected (non-FK) column is unchanged, each of the four FK columns is
--   either unchanged or transitions non-null -> null, and at least one FK
--   column actually goes non-null -> null. DELETE stays fully rejected; any
--   ordinary UPDATE (including setting an FK to a different non-null value, or
--   changing any content/decision/evidence/audit column) stays rejected. The
--   immutable audit content is never altered — only a now-dangling reference is
--   nulled, which is the intended referential semantics.
--
-- Unchanged by this migration: table shape, RLS, FORCE RLS, grants/privileges,
-- policies, capabilities, and every other Jarvis behaviour. Nothing is widened.
-- ============================================================================

create or replace function public.jarvis_action_events_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- DELETE is never permitted (true append-only).
  if tg_op = 'DELETE' then
    raise exception 'jarvis_action_events is append-only: DELETE is not permitted'
      using errcode = 'BB62A';
  end if;

  -- Permit ONLY a referential-integrity SET NULL: every protected column stays
  -- identical, each nullable FK column is either identical or non-null -> null,
  -- and at least one FK column actually transitions non-null -> null.
  if
    -- protected (non-FK) columns must be byte-for-byte unchanged
        new.event_id           is not distinct from old.event_id
    and new.seq                is not distinct from old.seq
    and new.workspace_id       is not distinct from old.workspace_id
    and new.occurred_at        is not distinct from old.occurred_at
    and new.actor_kind         is not distinct from old.actor_kind
    and new.is_proactive       is not distinct from old.is_proactive
    and new.capability_id      is not distinct from old.capability_id
    and new.decision           is not distinct from old.decision
    and new.risk_class         is not distinct from old.risk_class
    and new.executed           is not distinct from old.executed
    and new.success            is not distinct from old.success
    and new.verification_state is not distinct from old.verification_state
    and new.evidence           is not distinct from old.evidence
    and new.sources            is not distinct from old.sources
    and new.idempotency_key    is not distinct from old.idempotency_key
    and new.error              is not distinct from old.error
    and new.detail             is not distinct from old.detail
    -- each FK column: unchanged, or a non-null -> null nullification
    and (new.initiated_by     is not distinct from old.initiated_by     or (old.initiated_by     is not null and new.initiated_by     is null))
    and (new.approval_by      is not distinct from old.approval_by      or (old.approval_by      is not null and new.approval_by      is null))
    and (new.target_client_id is not distinct from old.target_client_id or (old.target_client_id is not null and new.target_client_id is null))
    and (new.proposal_id      is not distinct from old.proposal_id      or (old.proposal_id      is not null and new.proposal_id      is null))
    -- and at least one FK column actually went non-null -> null
    and (
         (old.initiated_by     is not null and new.initiated_by     is null)
      or (old.approval_by      is not null and new.approval_by      is null)
      or (old.target_client_id is not null and new.target_client_id is null)
      or (old.proposal_id      is not null and new.proposal_id      is null)
    )
  then
    return new;  -- system FK ON DELETE SET NULL only
  end if;

  raise exception 'jarvis_action_events is append-only: UPDATE is not permitted'
    using errcode = 'BB62A';
end;
$$;

-- Re-affirm the trigger (idempotent; unchanged shape — BEFORE UPDATE OR DELETE,
-- per row, executing the now-hardened function by name).
drop trigger if exists jarvis_action_events_no_mutation on public.jarvis_action_events;
create trigger jarvis_action_events_no_mutation
  before update or delete on public.jarvis_action_events
  for each row execute function public.jarvis_action_events_reject_mutation();
