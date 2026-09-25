-- ============================================================================
-- Bbettr OS — JARVIS INTELLIGENCE V1, Slice A (0067): conversation substrate.
--
-- Additive. Builds on Foundation 1 (0062/0063), Memory v1 (0064/0065), and F1
-- privilege hardening (0066). Creates the SECURE persistent conversation store
-- the future Intelligence layer will use. NO provider, NO LLM, NO orchestrator,
-- NO capability/registry change here — storage + security only.
--
--   public.jarvis_threads   — one conversation per row. OWNER-ONLY (a founder's
--     private Jarvis transcript is not shared with other founders). Mutable
--     metadata (title/status/last_client_id/updated_at/archived_at); archive is
--     preferred over delete. last_client_id is a deterministic conversational
--     referent ONLY — it never grants access to that client.
--   public.jarvis_messages  — APPEND-ONLY conversation turns (reject-mutation
--     trigger with the FK carve-out discipline from 0063/0064). Roles are
--     constrained to ('user','assistant') — there is deliberately NO persisted
--     'system' role, so stored text can never masquerade as trusted system
--     instructions. No raw prompt / raw context / chain-of-thought columns.
--
-- SECURITY: reads are CAPABILITY-DRIVEN and OWNER-ONLY — workspace + internal
-- Jarvis identity + effective jarvis.use grant + auth.uid()==owner. This composes
-- with requireJarvisUser() at the app boundary (defense in depth), mirroring the
-- Memory RLS precedent. Writes are service_role only. Least-privilege ACLs are
-- set explicitly (Supabase defaults revoked first, per 0065/0066).
-- ============================================================================

-- ── jarvis.use capability helper (DB-layer, mirrors jarvis_can_read_memory) ──
-- True iff the principal is an internal agency identity in the current workspace
-- AND holds an effective jarvis.use grant (raw or via a bundle that confers it).
-- Keep the bundle list in sync with bundles.ts BUNDLES that include jarvis.use
-- (asserted by a DB test). Clients/reps fail jarvis_is_internal() → false even
-- with a mistaken grant. SECURITY DEFINER; fail-closed.
create or replace function public.jarvis_has_use()
  returns boolean language sql security definer set search_path = public stable as $fn$
  select public.jarvis_is_internal() and exists (
    select 1 from public.jarvis_capability_grants g
    where g.subject_user_id = auth.uid()
      and g.workspace_id = public.current_workspace_id()
      and g.grant_key in ('jarvis.use','bundle:founder','bundle:readonly_staff')
  );
$fn$;

-- ── Conversation threads (owner-only; mutable metadata) ──────────────────────
create table if not exists public.jarvis_threads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  title         text check (title is null or char_length(title) <= 200),
  status        text not null default 'active' check (status in ('active','archived')),
  -- Deterministic conversational referent ONLY. Never a grant of access to the
  -- client; cleared automatically if the client is removed.
  last_client_id uuid references public.clients (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index if not exists jarvis_threads_owner_idx
  on public.jarvis_threads (workspace_id, user_id, status, updated_at desc);

alter table public.jarvis_threads enable row level security;
-- Revoke Supabase defaults from ALL roles (incl. service_role) before granting the
-- intended subset — otherwise service_role keeps the default DELETE/TRUNCATE.
revoke all on public.jarvis_threads from anon, authenticated, service_role;
grant select on public.jarvis_threads to authenticated;
grant select, insert, update on public.jarvis_threads to service_role;  -- no DELETE: archive-preferred
-- Owner-only read: correct workspace + internal jarvis-enabled identity + owner.
drop policy if exists "Read own jarvis threads" on public.jarvis_threads;
create policy "Read own jarvis threads"
  on public.jarvis_threads for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and user_id = auth.uid()
    and public.jarvis_has_use()
  );

-- ── Append-only conversation messages ───────────────────────────────────────
create table if not exists public.jarvis_messages (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,
  -- A message ALWAYS belongs to a thread and inherits its lifecycle/privacy.
  -- ON DELETE CASCADE: deleting a thread (or an owner profile → its threads)
  -- removes the messages — no detached orphan transcripts. Direct deletion is
  -- prevented by the privilege layer (no role is granted DELETE), so the only
  -- deletes are legitimate parent cascades; the append-only trigger therefore
  -- guards UPDATE only (a BEFORE DELETE reject trigger would block the cascade).
  thread_id        uuid not null references public.jarvis_threads (id) on delete cascade,
  workspace_id     uuid not null references public.workspaces (id),
  role             text not null check (role in ('user','assistant')),
  content          text not null check (char_length(content) between 1 and 20000),
  status           text not null default 'ok' check (status in ('ok','error')),
  -- Correlates one user turn with its assistant/failure response.
  request_id       uuid not null default gen_random_uuid(),
  -- Safe, displayable rationale (NOT hidden chain-of-thought). App/trusted-owned.
  reasoning_summary text check (reasoning_summary is null or char_length(reasoning_summary) <= 4000),
  -- Trusted-recorded (NOT model-claimed) context references for provenance.
  provenance       jsonb,
  -- At most one typed proposed intent (validated against the F1 registry by app).
  proposed_intent  jsonb,
  uncertainty      jsonb,
  -- Trusted observability (vendor-neutral; written by later slices). NEVER any
  -- raw prompt/context, credentials, tokens, or chain-of-thought.
  provider         text check (provider is null or char_length(provider) <= 60),
  model            text check (model is null or char_length(model) <= 120),
  usage            jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists jarvis_messages_thread_idx
  on public.jarvis_messages (thread_id, seq);
create index if not exists jarvis_messages_request_idx
  on public.jarvis_messages (request_id);

alter table public.jarvis_messages enable row level security;
alter table public.jarvis_messages force row level security;
revoke all on public.jarvis_messages from anon, authenticated, service_role;
grant insert, select on public.jarvis_messages to service_role;  -- append-only
grant select on public.jarvis_messages to authenticated;

-- Message visibility helper: may the principal read the parent thread? SECURITY
-- DEFINER reads jarvis_threads as owner (bypasses its RLS → no recursion; never
-- references jarvis_messages). Fail-closed (unknown/null thread → false), so it
-- cannot become an information-disclosure oracle. Defined BEFORE the policy that
-- references it.
create or replace function public.jarvis_can_read_thread(p_thread uuid)
  returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (
    select 1 from public.jarvis_threads t
    where t.id = p_thread
      and t.workspace_id = public.current_workspace_id()
      and t.user_id = auth.uid()
      and public.jarvis_has_use()
  );
$fn$;

-- Readable only if the parent thread is readable by the principal.
drop policy if exists "Read messages of own threads" on public.jarvis_messages;
create policy "Read messages of own threads"
  on public.jarvis_messages for select to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.jarvis_can_read_thread(thread_id)
  );

-- Append-only immutability: reject ALL direct UPDATEs (content is never edited;
-- corrections are new rows). Deletion is intentionally NOT guarded by a trigger —
-- direct deletes are impossible for every app role (no DELETE grant), and a
-- BEFORE DELETE trigger would also fire on, and block, legitimate parent-thread
-- ON DELETE CASCADE (a BEFORE DELETE row trigger fires for cascade-deleted rows).
-- So immutability = UPDATE trigger + no delete privilege; lifecycle cleanup =
-- parent cascade. No SET-NULL carve-out, no session flags, no bypasses.
create or replace function public.jarvis_messages_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'jarvis_messages is append-only: UPDATE is not permitted'
    using errcode = 'BB67A';
end;
$$;
drop trigger if exists jarvis_messages_no_mutation on public.jarvis_messages;
create trigger jarvis_messages_no_mutation
  before update on public.jarvis_messages
  for each row execute function public.jarvis_messages_reject_mutation();

-- ── Function EXECUTE ACLs (Supabase grants EXECUTE by default; harden now) ───
-- RLS-invoked helpers must remain EXECUTE-able by authenticated; drop PUBLIC+anon.
revoke all on function public.jarvis_has_use()               from public, anon;
revoke all on function public.jarvis_can_read_thread(uuid)   from public, anon;
grant execute on function public.jarvis_has_use()             to authenticated, service_role;
grant execute on function public.jarvis_can_read_thread(uuid) to authenticated, service_role;
-- Trigger-only function: no caller EXECUTE is required.
revoke all on function public.jarvis_messages_reject_mutation() from public, anon, authenticated;
