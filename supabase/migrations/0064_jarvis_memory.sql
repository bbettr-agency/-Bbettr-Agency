-- ============================================================================
-- Bbettr OS — JARVIS MEMORY V1 (0064): durable memory + append-only lineage.
--
-- Additive. Builds on Foundation 1 (0062/0063) and the agency workspace seam
-- (0036 workspaces / current_workspace_id, 0001 is_admin). Two primitives:
--
--   public.jarvis_memories        — the canonical store of durable, NON-
--     operational knowledge. One row = one atomic claim with provenance + a
--     lifecycle state. Portal remains the source of structured operational
--     truth; memory NEVER duplicates it (see 0064 notes / app layer). Content
--     columns are treated as immutable by the app layer — corrections create a
--     NEW row and supersede the old one; only lifecycle columns transition.
--
--   public.jarvis_memory_events   — APPEND-ONLY, IMMUTABLE lineage log (the
--     task_events / hardened jarvis_action_events discipline). Answers "why did
--     Jarvis's understanding change / why does it believe this". Uses the FK
--     carve-out from DAY ONE (never repeat the 0062 blanket-trigger bug).
--
-- SECURITY: agency-workspace scoped; admins read in their workspace; a user may
-- read their OWN user-scoped rows; clients & reps get NOTHING (no policy path).
-- Writes are service_role only (the trusted deterministic server path). Nothing
-- weakens existing Portal RLS, Planner FORCE RLS, or Foundation 1.
-- No secrets are ever stored here (enforced by the app-layer secret guard).
-- ============================================================================

-- ── Durable memory records (canonical store) ────────────────────────────────
create table if not exists public.jarvis_memories (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id),

  -- Scope: company-wide, about a client, or personal to one internal user.
  scope              text not null check (scope in ('agency','client','user')),
  client_id          uuid references public.clients (id)  on delete set null,
  user_id            uuid references public.profiles (id) on delete set null,
  -- Optional entity attachment for things without a first-class table.
  subject_kind       text check (subject_kind is null or char_length(subject_kind) <= 40),
  subject_ref        text check (subject_ref  is null or char_length(subject_ref)  <= 200),

  category           text not null check (category in
                       ('company_knowledge','client_knowledge','decision','commitment','preference_rule','context_note')),

  -- Atomic claim + optional longer body + category-specific structured fields.
  claim              text not null check (char_length(trim(claim)) between 1 and 2000),
  body               text check (body is null or char_length(body) <= 8000),
  structured         jsonb not null default '{}'::jsonb,

  -- Lifecycle. `current` = part of the active truth set (only observed/confirmed
  -- rows are current; proposed/inferred are not-yet-truth; superseded/retired/
  -- rejected are current=false).
  state              text not null default 'proposed' check (state in
                       ('observed','inferred','proposed','confirmed','superseded','retired','rejected')),
  current            boolean not null default false,
  importance         smallint not null default 0 check (importance between 0 and 3),

  -- Provenance ("why does Jarvis believe this?").
  source_kind        text not null check (source_kind in
                       ('human_statement','portal_record','document','system_event','model_inference')),
  source_ref         text check (source_ref is null or char_length(source_ref) <= 400),
  observed_at        timestamptz not null default now(),
  supplied_by        uuid references public.profiles (id) on delete set null,
  supplied_display   text check (supplied_display is null or char_length(supplied_display) <= 200),
  confirmed_by       uuid references public.profiles (id) on delete set null,
  confirmed_at       timestamptz,

  -- Supersession + conflict lineage (self references).
  supersedes_id      uuid references public.jarvis_memories (id) on delete set null,
  superseded_by_id   uuid references public.jarvis_memories (id) on delete set null,
  conflicts_with_id  uuid references public.jarvis_memories (id) on delete set null,

  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  retired_at         timestamptz,
  retired_reason     text check (retired_reason is null or char_length(retired_reason) <= 500),

  -- Scope coherence: the right entity ref is present for the scope, and only it.
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

alter table public.jarvis_memories enable row level security;
grant select on public.jarvis_memories to authenticated;
grant all    on public.jarvis_memories to service_role;
-- Admins read all memory in THEIR agency workspace; a (future non-admin) user
-- may read their OWN user-scoped rows. Clients/reps match nothing (not admin,
-- and no user-scoped rows are ever created for them). No authenticated WRITE
-- policy → only service_role (the trusted deterministic server path) may mutate.
drop policy if exists "Read jarvis memory in workspace" on public.jarvis_memories;
create policy "Read jarvis memory in workspace"
  on public.jarvis_memories for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (public.is_admin() or (scope = 'user' and user_id = auth.uid()))
  );

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
drop policy if exists "Admins read jarvis memory events" on public.jarvis_memory_events;
create policy "Admins read jarvis memory events"
  on public.jarvis_memory_events for select to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

-- Append-only guard WITH the FK ON DELETE SET NULL carve-out from day one
-- (memory_id, actor_user_id): DELETE always rejected; UPDATE permitted ONLY when
-- every protected column is unchanged, each FK column is unchanged or transitions
-- non-null -> null, and at least one FK column actually nullifies. Every ordinary
-- UPDATE stays rejected. (Mirrors the hardened 0063 discipline.)
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

-- ── Atomic correction / supersession ────────────────────────────────────────
-- A correction must move two memory rows together (old → superseded, new →
-- confirmed) AND write the lineage events, or do nothing. This function runs it
-- in ONE transaction. It re-guards the old row's state (defense in depth on top
-- of the app-layer state machine) and locks it FOR UPDATE. The app layer runs
-- the secret guard + authority check BEFORE calling this; nothing here trusts
-- content it did not receive. EXECUTE is service_role only.
create or replace function public.jarvis_memory_supersede(
  p_workspace     uuid,
  p_old_id        uuid,
  p_new           jsonb,
  p_actor         uuid,
  p_actor_display text,
  p_reason        text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_state text;
  v_new_id    uuid;
begin
  select state into v_old_state
    from public.jarvis_memories
    where id = p_old_id and workspace_id = p_workspace
    for update;
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
    p_workspace,
    p_new->>'scope',
    nullif(p_new->>'client_id','')::uuid,
    nullif(p_new->>'user_id','')::uuid,
    nullif(p_new->>'subject_kind',''),
    nullif(p_new->>'subject_ref',''),
    p_new->>'category',
    p_new->>'claim',
    nullif(p_new->>'body',''),
    coalesce(p_new->'structured', '{}'::jsonb),
    'confirmed', true, coalesce((p_new->>'importance')::smallint, 0),
    p_new->>'source_kind',
    nullif(p_new->>'source_ref',''),
    coalesce(nullif(p_new->>'observed_at','')::timestamptz, now()),
    p_actor, p_actor_display,
    p_actor, now(),
    p_old_id, p_actor
  ) returning id into v_new_id;

  update public.jarvis_memories
    set state = 'superseded', current = false, superseded_by_id = v_new_id
    where id = p_old_id and workspace_id = p_workspace;

  insert into public.jarvis_memory_events
    (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, p_old_id, 'superseded', 'human', p_actor, p_actor_display, p_reason,
            jsonb_build_object('superseded_by', v_new_id));
  insert into public.jarvis_memory_events
    (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason, detail)
    values (p_workspace, v_new_id, 'corrected', 'human', p_actor, p_actor_display, p_reason,
            jsonb_build_object('supersedes', p_old_id));

  return v_new_id;
end;
$$;
revoke all on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text) from public;
grant execute on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text) to service_role;
