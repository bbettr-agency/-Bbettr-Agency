-- ============================================================================
-- Bbettr OS — Planner Tasks: recurring_definitions (B4, migration 0041).
--
-- Templates that will (LATER) generate task instances (see
-- schema-and-migration-spec.md §11, persistence-architecture.md §10). A
-- recurring definition is NOT a task; generated instances are independent;
-- editing a definition affects only FUTURE generation and never rewrites
-- existing instances.
--
-- STRICT SCOPE — this migration stores definitions and wires the tasks
-- idempotency key ONLY:
--   * public.recurring_definitions (+ constraints, audit trigger, RLS, indexes)
--   * tasks composite FK (workspace_id, recurrence_definition_id)
--       -> recurring_definitions(workspace_id, id)   [same-workspace]
--   * tasks PERMANENT partial unique (recurrence_definition_id, occurrence_slot)
--       where recurrence_definition_id is not null   [durable business key]
--
-- It adds NO recurrence generation logic, NO completion reactor, NO schedule
-- evaluator, NO next_occurrence advancement, NO task instances, NO events, and
-- NO change to task lifecycle behaviour. Semantic duplicate-generation no-op and
-- next_occurrence advancement arrive with the op/evaluator (0046). No 0042+
-- objects. Only simple v1 rules (interval + day/week/month) — no full RRULE /
-- BYDAY / exceptions / count / until.
--
-- NUMBERING: 0041. Prereq: 0037 (tasks recurrence columns + composite anchor).
-- ============================================================================

-- ── public.recurring_definitions ────────────────────────────────────────────
create table if not exists public.recurring_definitions (
  id                          uuid not null default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces (id),

  owner_user_id               uuid not null references public.profiles (id),
  default_assignee_id         uuid references public.profiles (id),

  template_title              text not null,
  template_description        text,
  template_priority           text not null,
  template_estimated_minutes  integer,
  template_client_id          uuid references public.clients (id),

  rule_interval               integer not null,
  rule_unit                   text not null,
  mode                        text not null,
  timezone                    text not null default 'Africa/Johannesburg',
  missed_policy               text not null,
  due_offset_days             integer,
  next_occurrence             date,

  active                      boolean not null default true,
  archived_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint recurring_definitions_pkey primary key (id),
  -- Composite-FK anchor so tasks can reference (workspace_id, id) same-workspace.
  constraint recurring_definitions_workspace_id_unique unique (workspace_id, id),

  constraint recurring_definitions_title_nonempty
    check (char_length(trim(template_title)) > 0),
  constraint recurring_definitions_priority_valid
    check (template_priority in ('critical','high','normal','low')),
  constraint recurring_definitions_estimate_positive
    check (template_estimated_minutes is null or template_estimated_minutes > 0),
  constraint recurring_definitions_interval_positive
    check (rule_interval > 0),
  constraint recurring_definitions_unit_valid
    check (rule_unit in ('day','week','month')),
  constraint recurring_definitions_mode_valid
    check (mode in ('completion','schedule')),
  constraint recurring_definitions_missed_policy_valid
    check (missed_policy in ('skip','roll')),
  constraint recurring_definitions_due_offset_nonneg
    check (due_offset_days is null or due_offset_days >= 0)
);

comment on table public.recurring_definitions is
  'Templates that generate task instances (internal admin-only). NOT a task; '
  'editing affects only future generation; generated instances are independent. '
  'Read-only via RLS; writes flow through the op (0046). Stores definitions '
  'ONLY — generation/evaluator/reactor logic is deferred.';

-- Audit + immutability trigger — mechanical (mirrors 0037's tasks trigger).
-- Advances updated_at; holds id/workspace_id/created_at immutable. Every other
-- field (templates, rules, mode, timezone, missed_policy, due_offset_days,
-- next_occurrence, active, archived_at) is editable — edits affect only FUTURE
-- generation. NO actor stamping (owner comes from the op, not auth.uid()); NO
-- lifecycle/generation logic.
create or replace function public.recurring_definitions_enforce_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.id           := old.id;            -- immutable
    new.workspace_id := old.workspace_id;  -- immutable
    new.created_at   := old.created_at;    -- immutable
    new.updated_at   := now();
  end if;
  return new;
end;
$$;

drop trigger if exists recurring_definitions_enforce_audit on public.recurring_definitions;
create trigger recurring_definitions_enforce_audit
  before insert or update on public.recurring_definitions
  for each row
  execute function public.recurring_definitions_enforce_audit();

-- Evaluator indexes (partial).
create index if not exists recurring_definitions_schedule_due_idx
  on public.recurring_definitions (next_occurrence)
  where mode = 'schedule' and active;
create index if not exists recurring_definitions_active_idx
  on public.recurring_definitions (workspace_id)
  where active;

-- RLS — admin + workspace, read-only. The service-role evaluator advances
-- next_occurrence; ordinary authenticated users get read-only.
alter table public.recurring_definitions enable row level security;
alter table public.recurring_definitions force row level security;

drop policy if exists recurring_definitions_select_admin on public.recurring_definitions;
create policy recurring_definitions_select_admin
  on public.recurring_definitions
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

grant select on public.recurring_definitions to authenticated;
grant all    on public.recurring_definitions to service_role;
revoke all   on public.recurring_definitions from anon;

-- ── tasks: recurrence FK + permanent idempotency key (columns exist from 0037) ─
-- Same-workspace composite FK. recurrence_definition_id is nullable, so under
-- MATCH SIMPLE the FK is not checked for non-recurring tasks; the 0037 pairing
-- CHECK already ties recurrence_definition_id and occurrence_slot together.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_recurrence_definition_fk'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_recurrence_definition_fk
      foreign key (workspace_id, recurrence_definition_id)
      references public.recurring_definitions (workspace_id, id);
  end if;
end
$$;

-- PERMANENT generation idempotency: at most one task per (definition, slot).
-- Partial (recurring rows only) so the many non-recurring (null,null) tasks are
-- excluded. Independent of command_receipts TTL.
create unique index if not exists tasks_recurrence_occurrence_idx
  on public.tasks (recurrence_definition_id, occurrence_slot)
  where recurrence_definition_id is not null;
