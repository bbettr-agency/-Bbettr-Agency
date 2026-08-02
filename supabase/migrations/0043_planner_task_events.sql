-- ============================================================================
-- Bbettr OS — Planner Tasks: task_events (B4, migration 0043).
--
-- The APPEND-ONLY, IMMUTABLE domain event log (see schema-and-migration-spec.md
-- §13, §18–§19; task-domain-architecture.md §9). The audit trail AND the
-- integration contract for automation/reporting. Every event is past-tense and
-- never mutated; per-task order is (aggregate_version, event_sequence); there is
-- NO global order (global_seq is a non-semantic convenience only).
--
-- STRICT SCOPE — this migration stores events ONLY: the table, its CHECKs/FKs/
-- unique, the append-only reject-mutation trigger, and service-role-only RLS.
--
-- OUT OF SCOPE (built later): emitting events (the internal op/reactors, 0046),
-- the safe admin read model (§17, 0047), the event_redactions overlay +
-- EventRedacted (0044), command_receipts + any FK (0045), payload-contract
-- validation logic, reporting/analytics indexes, and partitioning. This
-- migration changes NO task lifecycle state and adds NO trigger to any other
-- table.
--
-- Enforcement (three layers): RLS enable+force with NO policies (admins never
-- read raw — the 0047 safe read model is the only human surface); privileges
-- narrowed so even service_role has only INSERT+SELECT (no UPDATE/DELETE); and a
-- reject-mutation trigger that raises on ANY UPDATE/DELETE for EVERY role.
-- Redaction (0044) is a separate OVERLAY, never a mutation of these rows.
--
-- NUMBERING: 0043. Prereq: 0037 (tasks + the (workspace_id,id) composite anchor).
-- ============================================================================

create table if not exists public.task_events (
  event_id                uuid not null default gen_random_uuid(),
  workspace_id            uuid not null,
  task_id                 uuid not null,

  aggregate_version       integer not null,   -- version AFTER this command
  event_sequence          integer not null,   -- 1..N within the command

  event_type              text not null,
  event_schema_version    integer not null,   -- per-type payload version

  actor_kind              text not null,
  actor_user_id           uuid references public.profiles (id) on delete set null,  -- set only for kind=user
  actor_ref               text,               -- stable id for automation/system
  actor_display           text not null,      -- immutable snapshot (survives deactivation)

  occurred_at             timestamptz not null default now(),
  correlation_id          uuid,               -- request/chain grouping
  causation_id            uuid,               -- causing event/command
  command_idempotency_key text,               -- logical link to command_receipts (0045); no FK

  payload                 jsonb not null,     -- SANITIZED domain facts only

  -- Non-semantic monotonic convenience for keyset pagination/debugging. It is
  -- NOT a global-order guarantee — per-task order is (aggregate_version,
  -- event_sequence) only.
  global_seq              bigserial,

  constraint task_events_pkey primary key (event_id),

  -- Same-workspace: an event's task must live in the event's workspace.
  constraint task_events_task_fk
    foreign key (workspace_id, task_id)
    references public.tasks (workspace_id, id),

  -- Per-task ordering + concurrency guard in one.
  constraint task_events_task_version_seq_unique
    unique (task_id, aggregate_version, event_sequence),

  -- Value domains (all fully null-safe → TRUE/FALSE only).
  constraint task_events_aggregate_version_valid
    check (aggregate_version >= 1),
  constraint task_events_event_sequence_valid
    check (event_sequence >= 1),
  constraint task_events_schema_version_valid
    check (event_schema_version > 0),
  constraint task_events_actor_kind_valid
    check (actor_kind in ('user','automation','system')),
  constraint task_events_actor_display_nonempty
    check (char_length(trim(actor_display)) > 0),
  -- A user id may appear ONLY on user events (compatible with ON DELETE SET NULL
  -- leaving a user event with a null id after deactivation).
  constraint task_events_actor_user_id_only_user
    check (actor_user_id is null or actor_kind = 'user'),
  -- actor_ref is for automation/system principals, never user events.
  constraint task_events_actor_ref_not_user
    check (actor_ref is null or actor_kind <> 'user'),

  -- The fixed v1 event vocabulary (36 approved names, task-domain-architecture
  -- §9). Future event types (comments/attachments/etc.) and EventRedacted (0044)
  -- are introduced deliberately by later migrations with their payload contract.
  constraint task_events_event_type_valid check (event_type in (
    -- lifecycle (14)
    'TaskCaptured','TaskTriaged','TaskScheduled','TaskRescheduled','TaskUnscheduled',
    'TaskStarted','TaskBlocked','TaskUnblocked','TaskDeferred','TaskCompleted',
    'TaskReopened','TaskArchived','TaskDropped','TaskRestored',
    -- assignment (3)
    'TaskOwnerChanged','TaskAssigned','TaskUnassigned',
    -- attributes (7)
    'TaskRenamed','TaskDescriptionEdited','TaskPriorityChanged','TaskDueDateChanged',
    'TaskEstimateChanged','TaskLabeled','TaskUnlabeled',
    -- structure (6)
    'SubtaskAdded','ChecklistItemAdded','ChecklistItemChecked',
    'DependencyAdded','DependencyRemoved','DependencyResolved',
    -- recurrence (4)
    'RecurringDefinitionCreated','RecurringDefinitionUpdated',
    'RecurringInstanceGenerated','RecurringInstanceMissed',
    -- temporal / derived (2)
    'TaskBecameOverdue','ReminderDue'
  ))
);

comment on table public.task_events is
  'Append-only, immutable domain event log (SERVICE-ROLE mutation only; append '
  'via INSERT). Admins never read raw — only the 0047 safe read model. Per-task '
  'order is (aggregate_version, event_sequence); global_seq is non-semantic. '
  'payload holds sanitized domain facts only.';

-- ── Append-only enforcement ─────────────────────────────────────────────────
-- Rejects every DELETE and every content-altering UPDATE, for EVERY role. The
-- ONE permitted UPDATE is the actor FK's own ON DELETE SET NULL action: nulling
-- actor_user_id (non-null -> null) with every other column unchanged. This
-- reconciles two approved requirements — absolute event immutability AND
-- actor_user_id ON DELETE SET NULL — so deleting a profile that authored events
-- succeeds while the event's content (incl. the actor_display snapshot) is never
-- altered. Redaction (0044) remains a separate overlay, never a mutation here.
create or replace function public.task_events_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'task_events is append-only: DELETE is not permitted'
      using errcode = 'BB43A';
  end if;
  -- Permit ONLY the FK ON DELETE SET NULL: actor_user_id non-null -> null with
  -- all other columns identical.
  if old.actor_user_id is not null and new.actor_user_id is null
     and new.event_id                is not distinct from old.event_id
     and new.workspace_id            is not distinct from old.workspace_id
     and new.task_id                 is not distinct from old.task_id
     and new.aggregate_version       is not distinct from old.aggregate_version
     and new.event_sequence          is not distinct from old.event_sequence
     and new.event_type              is not distinct from old.event_type
     and new.event_schema_version    is not distinct from old.event_schema_version
     and new.actor_kind              is not distinct from old.actor_kind
     and new.actor_ref               is not distinct from old.actor_ref
     and new.actor_display           is not distinct from old.actor_display
     and new.occurred_at             is not distinct from old.occurred_at
     and new.correlation_id          is not distinct from old.correlation_id
     and new.causation_id            is not distinct from old.causation_id
     and new.command_idempotency_key is not distinct from old.command_idempotency_key
     and new.payload                 is not distinct from old.payload
     and new.global_seq              is not distinct from old.global_seq
  then
    return new;  -- system FK SET NULL only
  end if;
  raise exception 'task_events is append-only: UPDATE is not permitted'
    using errcode = 'BB43A';
end;
$$;

drop trigger if exists task_events_reject_mutation on public.task_events;
create trigger task_events_reject_mutation
  before update or delete on public.task_events
  for each row
  execute function public.task_events_reject_mutation();

-- ── Row Level Security — service-role only, NO policies ─────────────────────
-- No SELECT policy: admins never read raw events (only the 0047 safe read model).
-- No INSERT/UPDATE/DELETE policy for authenticated. Only service_role reaches it.
alter table public.task_events enable row level security;
alter table public.task_events force row level security;

-- Privileges narrowed so even the engine role cannot mutate: INSERT + SELECT
-- only (UPDATE/DELETE denied at the privilege layer too, belt-and-suspenders
-- with the reject-mutation trigger).
revoke all on public.task_events from anon;
revoke all on public.task_events from authenticated;
revoke all on public.task_events from service_role;
grant insert, select on public.task_events to service_role;
-- bigserial default needs the sequence to be usable by the inserting role.
grant usage on sequence public.task_events_global_seq_seq to service_role;
