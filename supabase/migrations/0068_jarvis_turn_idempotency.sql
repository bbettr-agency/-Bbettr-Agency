-- ============================================================================
-- Bbettr OS — JARVIS INTELLIGENCE V1, Slice F1a (0068): transport idempotency
-- database primitives.
--
-- Additive. Builds on Foundation 1 (0062/0063), Memory v1 (0064/0065), F1
-- privilege hardening (0066) and the conversation substrate (0067). DATABASE
-- PRIMITIVES ONLY — no orchestrator, no Route Handler, no provider, no F1/Memory
-- application source. Creates the durable pieces a future retryable Jarvis
-- transport (Slice F1b–F1d) needs so a lost-response retry cannot produce
-- duplicate durable operational effects.
--
--   public.jarvis_turns  — one durable row per LOGICAL turn, claimed atomically by
--     trusted server code (F1b) via INSERT ... ON CONFLICT (workspace,user,
--     idempotency_key) DO NOTHING. OWNER-ONLY reads (mirrors 0067 threads). Ledger
--     integrity is DB-enforced: immutable claim columns; STRICT set-once
--     linkage/checkpoint columns; monotonic terminal statuses; state-coherence
--     CHECKs. The five linkage columns are PLAIN uuid AUDIT POINTERS (no FK): once
--     recorded, the historical id is preserved for the ledger's life — deleting the
--     referenced conversation/operational row never mutates the turn. The turn is
--     erased only via the owner-profile privacy cascade (user_id ON DELETE CASCADE).
--   public.jarvis_memories  — additive idempotency_key + idem_effect_hash columns +
--     a PARTIAL UNIQUE index for TRANSPORT/operation idempotency (NOT semantic
--     dedup). The canonical jarvis_memory_create() is replaced (old 5-arg dropped)
--     with a single idempotency-aware function so there is no legacy bypass.
--
-- SECURITY: owner-only reads via existing helpers; writes service_role only;
-- least-privilege ACLs set explicitly (Supabase defaults revoked first). Hashes are
-- computed by trusted server code in later slices; here they are stored and
-- shape-checked (lowercase SHA-256 hex). No hashing/canonicalization in SQL.
-- ============================================================================

-- ── Logical-turn idempotency ledger (owner-only; mutable with strict invariants) ─
create table if not exists public.jarvis_turns (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id),
  -- Owner. Privacy erasure: deleting the profile cascades the turn away.
  user_id              uuid not null references public.profiles (id) on delete cascade,
  -- AUDIT/correlation pointers — PLAIN uuid, NO FK (Option E). The historical id is
  -- preserved for the ledger's life; the referenced records keep their own lifecycle
  -- and their deletion does NOT mutate the turn. Strict set-once (see trigger).
  thread_id            uuid,
  user_message_id      uuid,
  assistant_message_id uuid,
  proposal_id          uuid,
  memory_id            uuid,
  -- Client-generated, stable across retries of one logical send (set by F1b).
  idempotency_key      uuid not null,
  -- Lowercase SHA-256 hex of the canonical transport envelope (computed in F1b).
  request_hash         text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  -- Correlates to jarvis_messages.request_id for this turn.
  correlation_id       uuid not null,
  status               text not null default 'processing'
                         check (status in ('processing','completed','failed','abandoned')),
  -- Staleness marker set at claim time (immutable; no lease renewal in V1). A turn
  -- cannot be born already expired.
  lease_expires_at     timestamptz not null,
  -- Set immediately before the external provider call — records the ambiguous
  -- "provider dispatched but no durable response yet" boundary for honest recovery.
  provider_started_at  timestamptz,
  -- Bounded trusted replay snapshot (shape defined in F1b). Hard BYTE bound (jsonb
  -- may contain multi-byte Unicode). NEVER any raw prompt/context/system prompt/
  -- hidden reasoning/provider body/keys.
  result               jsonb check (result is null or octet_length(result::text) <= 32768),
  failure_reason       text  check (failure_reason is null or char_length(failure_reason) <= 200),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Successful-completion timestamp ONLY (not a generic terminal_at).
  completed_at         timestamptz,
  -- The transport idempotency uniqueness primitive.
  constraint jarvis_turns_idem_unique unique (workspace_id, user_id, idempotency_key),
  -- A turn cannot be born with an already-expired lease.
  constraint jarvis_turns_lease_future check (lease_expires_at > created_at),
  -- State coherence (minimum useful; not a full workflow engine). provider_started_at
  -- and the linkage ids may legitimately exist while processing.
  constraint jarvis_turns_completed_at_coherent check ((status = 'completed') = (completed_at is not null)),
  constraint jarvis_turns_completed_coherent    check (status <> 'completed' or (result is not null and failure_reason is null)),
  constraint jarvis_turns_failed_coherent       check (status <> 'failed'    or (failure_reason is not null and btrim(failure_reason) <> '')),
  constraint jarvis_turns_abandoned_coherent    check (status <> 'abandoned' or (failure_reason is not null and btrim(failure_reason) <> '')),
  constraint jarvis_turns_processing_coherent   check (status <> 'processing' or (completed_at is null and result is null and failure_reason is null))
);
create index if not exists jarvis_turns_owner_idx
  on public.jarvis_turns (workspace_id, user_id, created_at desc);
-- Supports the future trusted recovery sweep for stale (crashed) processing turns.
create index if not exists jarvis_turns_stale_idx
  on public.jarvis_turns (lease_expires_at) where status = 'processing';

alter table public.jarvis_turns enable row level security;
alter table public.jarvis_turns force row level security;
-- Revoke Supabase defaults from ALL roles (incl. service_role) before granting the
-- intended subset — otherwise service_role keeps the default DELETE/TRUNCATE.
revoke all on public.jarvis_turns from anon, authenticated, service_role;
grant select on public.jarvis_turns to authenticated;
grant select, insert, update on public.jarvis_turns to service_role;  -- no DELETE: owner-cascade only

-- Owner-only read: correct workspace + internal jarvis-enabled identity + owner.
drop policy if exists "Read own jarvis turns" on public.jarvis_turns;
create policy "Read own jarvis turns"
  on public.jarvis_turns for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and user_id = auth.uid()
    and public.jarvis_has_use()
  );

-- ── Ledger integrity: immutable / STRICT set-once / monotonic-terminal ────────
-- Enforced in the DB, not just TypeScript. A terminal turn is fully immutable; the
-- claim-defining columns can never change; the linkage/checkpoint columns are STRICT
-- set-once (NULL → value once; any change to a non-NULL value, INCLUDING back to
-- NULL, is rejected). Because the linkage columns have NO foreign keys, no FK
-- ON DELETE SET NULL cascade can ever produce such an UPDATE, so there is (and must
-- be) NO cascade exception here — the service role cannot clear-and-repoint a link.
-- No BEFORE DELETE trigger (it would block the owner cascade); direct deletes are
-- already impossible (no DELETE grant to any role).
create or replace function public.jarvis_turns_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Terminal turns are immutable — no reopening, no result/failure rewrite,
  -- no failed→completed, no abandoned→processing, no linkage clearing.
  if OLD.status in ('completed','failed','abandoned') then
    raise exception 'jarvis_turns: turn is terminal and immutable (status=%)', OLD.status
      using errcode = 'BB68T';
  end if;

  -- Immutable-after-insert columns.
  if NEW.id              is distinct from OLD.id
    or NEW.workspace_id    is distinct from OLD.workspace_id
    or NEW.user_id         is distinct from OLD.user_id
    or NEW.idempotency_key is distinct from OLD.idempotency_key
    or NEW.request_hash    is distinct from OLD.request_hash
    or NEW.correlation_id  is distinct from OLD.correlation_id
    or NEW.lease_expires_at is distinct from OLD.lease_expires_at
    or NEW.created_at      is distinct from OLD.created_at then
    raise exception 'jarvis_turns: immutable column changed' using errcode = 'BB68I';
  end if;

  -- STRICT set-once: once a column is non-NULL it can never change again (a change to
  -- a different value OR back to NULL is rejected). Covers linkage + checkpoint cols.
  if OLD.thread_id            is not null and NEW.thread_id            is distinct from OLD.thread_id            then raise exception 'jarvis_turns: thread_id is set-once'            using errcode = 'BB68S'; end if;
  if OLD.user_message_id      is not null and NEW.user_message_id      is distinct from OLD.user_message_id      then raise exception 'jarvis_turns: user_message_id is set-once'      using errcode = 'BB68S'; end if;
  if OLD.assistant_message_id is not null and NEW.assistant_message_id is distinct from OLD.assistant_message_id then raise exception 'jarvis_turns: assistant_message_id is set-once' using errcode = 'BB68S'; end if;
  if OLD.proposal_id          is not null and NEW.proposal_id          is distinct from OLD.proposal_id          then raise exception 'jarvis_turns: proposal_id is set-once'          using errcode = 'BB68S'; end if;
  if OLD.memory_id            is not null and NEW.memory_id            is distinct from OLD.memory_id            then raise exception 'jarvis_turns: memory_id is set-once'            using errcode = 'BB68S'; end if;
  if OLD.provider_started_at  is not null and NEW.provider_started_at  is distinct from OLD.provider_started_at  then raise exception 'jarvis_turns: provider_started_at is set-once'  using errcode = 'BB68S'; end if;
  if OLD.result               is not null and NEW.result               is distinct from OLD.result               then raise exception 'jarvis_turns: result is set-once'               using errcode = 'BB68S'; end if;
  if OLD.completed_at         is not null and NEW.completed_at         is distinct from OLD.completed_at         then raise exception 'jarvis_turns: completed_at is set-once'         using errcode = 'BB68S'; end if;

  -- updated_at is server-owned; a caller cannot spoof it. Every legitimate UPDATE
  -- advances it honestly.
  NEW.updated_at := now();
  return NEW;
end;
$$;
drop trigger if exists jarvis_turns_no_mutation on public.jarvis_turns;
create trigger jarvis_turns_no_mutation
  before update on public.jarvis_turns
  for each row execute function public.jarvis_turns_reject_mutation();

-- ── Memory transport-idempotency primitives (additive) ───────────────────────
-- TRANSPORT/operation idempotency, NOT semantic Memory deduplication. Does not
-- touch inferred/current lifecycle, confirmation, supersession, conflict model,
-- visibility, RLS, or source_ref semantics.
alter table public.jarvis_memories
  add column if not exists idempotency_key  text,
  add column if not exists idem_effect_hash text;

do $$ begin
  -- Non-null key must be bounded AND non-blank (a whitespace-only operation key is
  -- meaningless). Original bytes are preserved; only the trimmed value is checked.
  if not exists (select 1 from pg_constraint where conname = 'jarvis_memories_idem_key_valid') then
    alter table public.jarvis_memories
      add constraint jarvis_memories_idem_key_valid
      check (idempotency_key is null or (char_length(idempotency_key) <= 200 and btrim(idempotency_key) <> ''));
  end if;
  -- Effect hash must be lowercase SHA-256 hex when present.
  if not exists (select 1 from pg_constraint where conname = 'jarvis_memories_idem_hash_hex') then
    alter table public.jarvis_memories
      add constraint jarvis_memories_idem_hash_hex
      check (idem_effect_hash is null or idem_effect_hash ~ '^[0-9a-f]{64}$');
  end if;
  -- Coherence: both NULL (legacy create) or both present (idempotent create).
  if not exists (select 1 from pg_constraint where conname = 'jarvis_memories_idem_coherent') then
    alter table public.jarvis_memories
      add constraint jarvis_memories_idem_coherent
      check ((idempotency_key is null) = (idem_effect_hash is null));
  end if;
end $$;

-- Partial UNIQUE: the operation key is unique among the rows that carry one.
create unique index if not exists jarvis_memories_idem_key_uniq
  on public.jarvis_memories (idempotency_key) where idempotency_key is not null;

-- ── Canonical Memory create: idempotency-aware, single callable path ──────────
-- CRITICAL: adding parameters via CREATE OR REPLACE would leave the old 5-arg
-- signature as a callable OVERLOAD (an idempotency bypass). We DROP the old
-- signature and CREATE a single function whose two new params DEFAULT NULL, so
-- existing 5-arg callers bind to it (legacy behavior) while 7-arg callers get
-- idempotency. After this migration exactly ONE jarvis_memory_create exists.
drop function if exists public.jarvis_memory_create(uuid, jsonb, uuid, text, text);

create or replace function public.jarvis_memory_create(
  p_workspace uuid, p_row jsonb, p_actor uuid, p_actor_display text, p_reason text,
  p_idempotency_key text default null, p_idem_effect_hash text default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_existing_id uuid; v_existing_hash text;
begin
  if p_idempotency_key is not null then
    -- Atomic get-or-create keyed by the trusted transport operation key. The
    -- partial unique index makes this race-safe (no check-then-insert TOCTOU).
    insert into public.jarvis_memories (
      workspace_id, scope, client_id, user_id, subject_kind, subject_ref, category,
      claim, body, structured, state, current, importance,
      source_kind, source_ref, observed_at, supplied_by, supplied_display, created_by,
      idempotency_key, idem_effect_hash
    ) values (
      p_workspace, p_row->>'scope', nullif(p_row->>'client_id','')::uuid, nullif(p_row->>'user_id','')::uuid,
      nullif(p_row->>'subject_kind',''), nullif(p_row->>'subject_ref',''), p_row->>'category',
      p_row->>'claim', nullif(p_row->>'body',''), coalesce(p_row->'structured','{}'::jsonb),
      p_row->>'state', coalesce((p_row->>'current')::boolean, false), coalesce((p_row->>'importance')::smallint, 0),
      p_row->>'source_kind', nullif(p_row->>'source_ref',''),
      coalesce(nullif(p_row->>'observed_at','')::timestamptz, now()),
      p_actor, p_actor_display, p_actor,
      p_idempotency_key, p_idem_effect_hash
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning id into v_id;

    if v_id is null then
      -- Existing operation for this key. Replay iff the effect fingerprint matches;
      -- otherwise this is a different operation under the same key → fail closed.
      select id, idem_effect_hash into v_existing_id, v_existing_hash
        from public.jarvis_memories where idempotency_key = p_idempotency_key;
      if v_existing_hash is distinct from p_idem_effect_hash then
        raise exception 'jarvis_memory_create: idempotency conflict (same key, different effect)'
          using errcode = 'BB68C';
      end if;
      return v_existing_id;  -- replay: no second row, no second 'created' event
    end if;

    -- New row → exactly one 'created' event.
    insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
      values (p_workspace, v_id, 'created', 'human', p_actor, p_actor_display, p_reason,
              jsonb_build_object('state', p_row->>'state', 'category', p_row->>'category', 'sourceKind', p_row->>'source_kind'));
    return v_id;
  end if;

  -- Legacy path (no idempotency key): original behavior, preserved exactly.
  insert into public.jarvis_memories (
    workspace_id, scope, client_id, user_id, subject_kind, subject_ref, category,
    claim, body, structured, state, current, importance,
    source_kind, source_ref, observed_at, supplied_by, supplied_display, created_by
  ) values (
    p_workspace, p_row->>'scope', nullif(p_row->>'client_id','')::uuid, nullif(p_row->>'user_id','')::uuid,
    nullif(p_row->>'subject_kind',''), nullif(p_row->>'subject_ref',''), p_row->>'category',
    p_row->>'claim', nullif(p_row->>'body',''), coalesce(p_row->'structured','{}'::jsonb),
    p_row->>'state', coalesce((p_row->>'current')::boolean, false), coalesce((p_row->>'importance')::smallint, 0),
    p_row->>'source_kind', nullif(p_row->>'source_ref',''),
    coalesce(nullif(p_row->>'observed_at','')::timestamptz, now()),
    p_actor, p_actor_display, p_actor
  ) returning id into v_id;
  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, v_id, 'created', 'human', p_actor, p_actor_display, p_reason,
            jsonb_build_object('state', p_row->>'state', 'category', p_row->>'category', 'sourceKind', p_row->>'source_kind'));
  return v_id;
end; $$;

-- ── Function EXECUTE ACLs (Supabase grants EXECUTE by default; harden now) ────
-- Preserve the established Memory boundary: service_role only (no PUBLIC/anon/
-- authenticated), matching 0065's posture for the previous signature.
revoke all on function public.jarvis_memory_create(uuid, jsonb, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.jarvis_memory_create(uuid, jsonb, uuid, text, text, text, text) to service_role;
-- Trigger-only function: no caller EXECUTE required.
revoke all on function public.jarvis_turns_reject_mutation() from public, anon, authenticated;
