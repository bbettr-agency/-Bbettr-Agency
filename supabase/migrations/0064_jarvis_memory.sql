-- ============================================================================
-- Bbettr OS — JARVIS MEMORY V1 (0064): durable memory + append-only lineage.
--
-- Additive. Builds on Foundation 1 (0062 grants/proposals/action-events,
-- 0063 FK carve-out) and the agency workspace seam (0036 workspaces /
-- current_workspace_id, 0001 is_admin). Primitives:
--
--   public.jarvis_memories        — canonical store of durable, NON-operational
--     knowledge. One row = one atomic claim + provenance + lifecycle state.
--     Portal stays the source of structured operational truth; memory never
--     duplicates it. Content columns are immutable by app-layer discipline —
--     corrections create a NEW row and supersede the old; only lifecycle columns
--     transition, and every transition is journalled ATOMICALLY (see RPCs).
--   public.jarvis_memory_events   — APPEND-ONLY, IMMUTABLE lineage log (the
--     hardened jarvis_action_events discipline), with the FK ON DELETE SET NULL
--     carve-out from day one.
--   public.jarvis_memory_conflicts— many-to-many "these two memories conflict"
--     edges (a memory may be in several conflicts; not a knowledge graph).
--
-- CAPABILITY-DRIVEN reads (not "admin = authorization"):
--   jarvis_is_internal()      — the principal is an internal agency identity in
--     THIS workspace (role not in client/rep, bound to the workspace). This is
--     the hard gate that excludes clients/reps even if a grant row exists.
--   jarvis_can_read_memory()  — internal AND holds an effective memory.read grant.
--   Reads compose: authenticated → internal identity → correct workspace →
--   effective memory.read → scope rules. Writes are service_role only.
--
-- ATOMICITY: every operation that mutates a memory AND must record lineage runs
-- as ONE transaction via a tightly-scoped SECURITY INVOKER RPC (execute granted
-- to service_role only; deterministic preconditions re-checked inside). There is
-- no generic command RPC and no authorization inside the RPCs — the server
-- boundary performs the F1 capability/authority checks before calling them.
-- ============================================================================

-- ── Durable memory records (canonical store) ────────────────────────────────
create table if not exists public.jarvis_memories (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id),

  scope              text not null check (scope in ('agency','client','user')),
  -- Scope-binding FKs CASCADE (consistent with Portal client-cascade, and
  -- required: the scope-coherence CHECK forbids nulling them, so SET NULL would
  -- block deleting a referenced client/user). Deleting a client/user removes the
  -- memory scoped to them; shared agency memory (no client/user) is unaffected.
  client_id          uuid references public.clients (id)  on delete cascade,
  user_id            uuid references public.profiles (id) on delete cascade,
  subject_kind       text check (subject_kind is null or char_length(subject_kind) <= 40),
  subject_ref        text check (subject_ref  is null or char_length(subject_ref)  <= 200),

  category           text not null check (category in
                       ('company_knowledge','client_knowledge','decision','commitment','preference_rule','context_note')),

  claim              text not null check (char_length(trim(claim)) between 1 and 2000),
  body               text check (body is null or char_length(body) <= 8000),
  structured         jsonb not null default '{}'::jsonb,

  state              text not null default 'proposed' check (state in
                       ('observed','inferred','proposed','confirmed','superseded','retired','rejected')),
  current            boolean not null default false,
  importance         smallint not null default 0 check (importance between 0 and 3),

  source_kind        text not null check (source_kind in
                       ('human_statement','portal_record','document','system_event','model_inference')),
  source_ref         text check (source_ref is null or char_length(source_ref) <= 400),
  observed_at        timestamptz not null default now(),
  supplied_by        uuid references public.profiles (id) on delete set null,
  supplied_display   text check (supplied_display is null or char_length(supplied_display) <= 200),
  confirmed_by       uuid references public.profiles (id) on delete set null,
  confirmed_at       timestamptz,

  supersedes_id      uuid references public.jarvis_memories (id) on delete set null,
  superseded_by_id   uuid references public.jarvis_memories (id) on delete set null,

  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  retired_at         timestamptz,
  retired_reason     text check (retired_reason is null or char_length(retired_reason) <= 500),

  constraint jarvis_memories_scope_coherent check (
       (scope = 'agency' and client_id is null     and user_id is null)
    or (scope = 'client' and client_id is not null and user_id is null)
    or (scope = 'user'   and user_id  is not null  and client_id is null)
  )
);
create index if not exists jarvis_memories_scope_idx
  on public.jarvis_memories (workspace_id, scope, client_id, current);
create index if not exists jarvis_memories_user_idx
  on public.jarvis_memories (workspace_id, user_id, current);
create index if not exists jarvis_memories_supersedes_idx
  on public.jarvis_memories (supersedes_id);

-- ── Capability-aware read helpers (SECURITY DEFINER) ────────────────────────
-- jarvis_is_internal: an internal agency identity bound to the CURRENT workspace.
-- role not in ('client','rep') excludes client/rep profiles REGARDLESS of any
-- grant row; a future 'staff' role would be internal by default. Fail-closed.
create or replace function public.jarvis_is_internal()
  returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role not in ('client','rep')
      and p.workspace_id is not null
      and p.workspace_id = public.current_workspace_id()
  );
$fn$;

-- jarvis_can_read_memory: internal AND holds an effective memory.read grant in
-- this workspace. The grant may be the raw key or a bundle that confers it.
-- KEEP THE BUNDLE LIST IN SYNC WITH bundles.ts BUNDLES that include memory.read
-- (asserted by a DB test). Clients/reps can never pass jarvis_is_internal(), so a
-- mistaken/malicious grant row on their profile grants nothing.
create or replace function public.jarvis_can_read_memory()
  returns boolean language sql security definer set search_path = public stable as $fn$
  select public.jarvis_is_internal() and exists (
    select 1 from public.jarvis_capability_grants g
    where g.subject_user_id = auth.uid()
      and g.workspace_id = public.current_workspace_id()
      and g.grant_key in ('memory.read','bundle:founder','bundle:readonly_staff')
  );
$fn$;

alter table public.jarvis_memories enable row level security;
grant select on public.jarvis_memories to authenticated;
grant all    on public.jarvis_memories to service_role;
-- Reads are CAPABILITY-DRIVEN. SHARED memory (agency/client) is readable by an
-- internal user holding effective memory.read. USER-scoped memory is PERSONAL:
-- readable only by its owner (an internal identity). NO authenticated write
-- policy → service_role only. Clients/reps: jarvis_is_internal() is false ⇒
-- nothing, even if a grant row exists for them.
drop policy if exists "Read jarvis memory in workspace" on public.jarvis_memories;
create policy "Read jarvis memory in workspace"
  on public.jarvis_memories for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (
      (scope in ('agency','client') and public.jarvis_can_read_memory())
      or (scope = 'user' and user_id = auth.uid() and public.jarvis_is_internal())
    )
  );

-- ── Conflict edges (many-to-many; a memory may be in several conflicts) ──────
create table if not exists public.jarvis_memory_conflicts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id),
  memory_id        uuid not null references public.jarvis_memories (id) on delete cascade,
  other_memory_id  uuid not null references public.jarvis_memories (id) on delete cascade,
  reason           text check (reason is null or char_length(reason) <= 500),
  flagged_by       uuid references public.profiles (id) on delete set null,
  flagged_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,
  constraint jarvis_memory_conflicts_distinct check (memory_id <> other_memory_id),
  constraint jarvis_memory_conflicts_pair_unique unique (memory_id, other_memory_id)
);
create index if not exists jarvis_memory_conflicts_open_idx
  on public.jarvis_memory_conflicts (workspace_id, memory_id) where resolved_at is null;

alter table public.jarvis_memory_conflicts enable row level security;
grant select on public.jarvis_memory_conflicts to authenticated;
grant all    on public.jarvis_memory_conflicts to service_role;
drop policy if exists "Read jarvis memory conflicts" on public.jarvis_memory_conflicts;
create policy "Read jarvis memory conflicts"
  on public.jarvis_memory_conflicts for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.jarvis_can_read_memory());

-- ── Append-only memory lineage / audit log ──────────────────────────────────
create table if not exists public.jarvis_memory_events (
  event_id       uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  workspace_id   uuid not null references public.workspaces (id),
  memory_id      uuid references public.jarvis_memories (id) on delete set null,
  occurred_at    timestamptz not null default now(),
  event_type     text not null check (event_type in
                   ('created','confirmed','superseded','corrected','conflict_flagged','retired','rejected','redacted')),
  actor_kind     text not null check (actor_kind in ('jarvis','human','system')),
  actor_user_id  uuid references public.profiles (id) on delete set null,
  actor_display  text check (actor_display is null or char_length(actor_display) <= 200),
  reason         text check (reason is null or char_length(reason) <= 500),
  detail         jsonb
);
create index if not exists jarvis_memory_events_mem_idx
  on public.jarvis_memory_events (workspace_id, memory_id, occurred_at desc);

alter table public.jarvis_memory_events enable row level security;
alter table public.jarvis_memory_events force row level security;
revoke all on public.jarvis_memory_events from anon;
revoke all on public.jarvis_memory_events from authenticated;
revoke all on public.jarvis_memory_events from service_role;
grant insert, select on public.jarvis_memory_events to service_role;
grant select on public.jarvis_memory_events to authenticated;
-- Reading lineage is capability-driven, same as memory (internal + memory.read).
drop policy if exists "Admins read jarvis memory events" on public.jarvis_memory_events;
drop policy if exists "Read jarvis memory events" on public.jarvis_memory_events;
create policy "Read jarvis memory events"
  on public.jarvis_memory_events for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.jarvis_can_read_memory());

-- Append-only guard WITH the FK ON DELETE SET NULL carve-out (memory_id,
-- actor_user_id): DELETE always rejected; UPDATE permitted ONLY when every
-- protected column is unchanged, each FK column is unchanged or non-null -> null,
-- and at least one FK column nullifies. (Mirrors the hardened 0063 discipline.)
create or replace function public.jarvis_memory_events_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'jarvis_memory_events is append-only: DELETE is not permitted'
      using errcode = 'BB64A';
  end if;
  if
        new.event_id      is not distinct from old.event_id
    and new.seq           is not distinct from old.seq
    and new.workspace_id  is not distinct from old.workspace_id
    and new.occurred_at   is not distinct from old.occurred_at
    and new.event_type    is not distinct from old.event_type
    and new.actor_kind    is not distinct from old.actor_kind
    and new.actor_display is not distinct from old.actor_display
    and new.reason        is not distinct from old.reason
    and new.detail        is not distinct from old.detail
    and (new.memory_id     is not distinct from old.memory_id     or (old.memory_id     is not null and new.memory_id     is null))
    and (new.actor_user_id is not distinct from old.actor_user_id or (old.actor_user_id is not null and new.actor_user_id is null))
    and (
         (old.memory_id     is not null and new.memory_id     is null)
      or (old.actor_user_id is not null and new.actor_user_id is null)
    )
  then
    return new;  -- system FK ON DELETE SET NULL only
  end if;
  raise exception 'jarvis_memory_events is append-only: UPDATE is not permitted'
    using errcode = 'BB64A';
end;
$$;
drop trigger if exists jarvis_memory_events_no_mutation on public.jarvis_memory_events;
create trigger jarvis_memory_events_no_mutation
  before update or delete on public.jarvis_memory_events
  for each row execute function public.jarvis_memory_events_reject_mutation();

-- ── Atomic mutation RPCs (row + lineage event in ONE transaction) ───────────
-- Each is service_role-execute-only, SECURITY INVOKER, with deterministic
-- preconditions re-checked inside. No authorization here — the server boundary
-- ran the F1 capability/authority + pure state-machine checks first.

-- CREATE: insert a memory (state/current already decided by the ingestion policy)
-- plus its 'created' lineage event.
create or replace function public.jarvis_memory_create(
  p_workspace uuid, p_row jsonb, p_actor uuid, p_actor_display text, p_reason text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
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

-- CONFIRM: guarded transition p_from -> confirmed + 'confirmed' event, atomic.
-- Returns false (no event) if the guard did not match (racing/ineligible).
create or replace function public.jarvis_memory_confirm(
  p_workspace uuid, p_id uuid, p_from text, p_actor uuid, p_actor_display text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_updated int;
begin
  update public.jarvis_memories
     set state = 'confirmed', current = true, confirmed_by = p_actor, confirmed_at = now()
   where id = p_id and workspace_id = p_workspace and state = p_from;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return false; end if;
  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, detail)
    values (p_workspace, p_id, 'confirmed', 'human', p_actor, p_actor_display, jsonb_build_object('from', p_from));
  return true;
end; $$;

-- RETIRE: guarded transition p_from -> retired + 'retired' event, atomic.
create or replace function public.jarvis_memory_retire(
  p_workspace uuid, p_id uuid, p_from text, p_reason text, p_actor uuid, p_actor_display text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_updated int;
begin
  update public.jarvis_memories
     set state = 'retired', current = false, retired_at = now(), retired_reason = left(p_reason, 500)
   where id = p_id and workspace_id = p_workspace and state = p_from;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return false; end if;
  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, p_id, 'retired', 'human', p_actor, p_actor_display, left(p_reason, 500), jsonb_build_object('from', p_from));
  return true;
end; $$;

-- FLAG CONFLICT: create/refresh the two directed edges + two 'conflict_flagged'
-- events, atomic. A memory may be in many conflicts.
create or replace function public.jarvis_memory_flag_conflict(
  p_workspace uuid, p_a uuid, p_b uuid, p_actor uuid, p_actor_display text, p_reason text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_cnt int;
begin
  if p_a = p_b then raise exception 'conflict requires two distinct memories' using errcode = 'BB64C'; end if;
  select count(*) into v_cnt from public.jarvis_memories where id in (p_a, p_b) and workspace_id = p_workspace;
  if v_cnt <> 2 then raise exception 'both memories must exist in the workspace' using errcode = 'BB64C'; end if;

  insert into public.jarvis_memory_conflicts (workspace_id, memory_id, other_memory_id, reason, flagged_by)
    values (p_workspace, p_a, p_b, left(p_reason, 500), p_actor)
    on conflict (memory_id, other_memory_id)
    do update set resolved_at = null, resolved_by = null, reason = excluded.reason, flagged_by = excluded.flagged_by, flagged_at = now();
  insert into public.jarvis_memory_conflicts (workspace_id, memory_id, other_memory_id, reason, flagged_by)
    values (p_workspace, p_b, p_a, left(p_reason, 500), p_actor)
    on conflict (memory_id, other_memory_id)
    do update set resolved_at = null, resolved_by = null, reason = excluded.reason, flagged_by = excluded.flagged_by, flagged_at = now();

  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, p_a, 'conflict_flagged', 'human', p_actor, p_actor_display, left(p_reason, 500), jsonb_build_object('conflicts_with', p_b));
  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, p_b, 'conflict_flagged', 'human', p_actor, p_actor_display, left(p_reason, 500), jsonb_build_object('conflicts_with', p_a));
  return true;
end; $$;

-- SUPERSEDE (correction): new confirmed row + old superseded + both lineage
-- events, atomic. Re-guards the old state. (unchanged discipline)
create or replace function public.jarvis_memory_supersede(
  p_workspace uuid, p_old_id uuid, p_new jsonb, p_actor uuid, p_actor_display text, p_reason text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_old_state text; v_new_id uuid;
begin
  select state into v_old_state from public.jarvis_memories
    where id = p_old_id and workspace_id = p_workspace for update;
  if not found then
    raise exception 'supersede: old memory not found in workspace' using errcode = 'BB64B';
  end if;
  if v_old_state in ('superseded','retired','rejected') then
    raise exception 'supersede: old memory not supersedable (state=%)', v_old_state using errcode = 'BB64B';
  end if;

  insert into public.jarvis_memories (
    workspace_id, scope, client_id, user_id, subject_kind, subject_ref, category,
    claim, body, structured, state, current, importance,
    source_kind, source_ref, observed_at, supplied_by, supplied_display,
    confirmed_by, confirmed_at, supersedes_id, created_by
  ) values (
    p_workspace, p_new->>'scope', nullif(p_new->>'client_id','')::uuid, nullif(p_new->>'user_id','')::uuid,
    nullif(p_new->>'subject_kind',''), nullif(p_new->>'subject_ref',''), p_new->>'category',
    p_new->>'claim', nullif(p_new->>'body',''), coalesce(p_new->'structured', '{}'::jsonb),
    'confirmed', true, coalesce((p_new->>'importance')::smallint, 0),
    p_new->>'source_kind', nullif(p_new->>'source_ref',''),
    coalesce(nullif(p_new->>'observed_at','')::timestamptz, now()),
    p_actor, p_actor_display, p_actor, now(), p_old_id, p_actor
  ) returning id into v_new_id;

  update public.jarvis_memories
    set state = 'superseded', current = false, superseded_by_id = v_new_id
    where id = p_old_id and workspace_id = p_workspace;

  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, p_old_id, 'superseded', 'human', p_actor, p_actor_display, p_reason, jsonb_build_object('superseded_by', v_new_id));
  insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, v_new_id, 'corrected', 'human', p_actor, p_actor_display, p_reason, jsonb_build_object('supersedes', p_old_id));
  return v_new_id;
end; $$;

revoke all on function public.jarvis_memory_create(uuid,jsonb,uuid,text,text) from public;
revoke all on function public.jarvis_memory_confirm(uuid,uuid,text,uuid,text) from public;
revoke all on function public.jarvis_memory_retire(uuid,uuid,text,text,uuid,text) from public;
revoke all on function public.jarvis_memory_flag_conflict(uuid,uuid,uuid,uuid,text,text) from public;
revoke all on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text) from public;
grant execute on function public.jarvis_memory_create(uuid,jsonb,uuid,text,text) to service_role;
grant execute on function public.jarvis_memory_confirm(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.jarvis_memory_retire(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.jarvis_memory_flag_conflict(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text) to service_role;
