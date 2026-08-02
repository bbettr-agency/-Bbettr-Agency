-- ============================================================================
-- Bbettr OS — Planner Tasks: event_redactions overlay (B4, migration 0044).
--
-- The privacy REDACTION OVERLAY for the immutable event log (see
-- schema-and-migration-spec.md §14, §18–§19; persistence-architecture.md §17).
-- Original task_events rows are NEVER touched — redactions sit beside them and
-- the 0047 safe read model joins the overlay to suppress/mask declared fields.
--
-- STRICT SCOPE — this migration:
--   * creates public.event_redactions (overlay storage) + its reject-mutation
--     trigger + service-role RLS;
--   * adds a UNIQUE (workspace_id, event_id) to task_events so the overlay can
--     reference events via a same-workspace COMPOSITE FK (the one structural
--     enabler); and
--   * extends the task_events event_type CHECK to admit 'EventRedacted' (the
--     37th name) so a redaction's audit event can later be recorded.
--
-- OUT OF SCOPE (built later): applying redactions (the 0047 safe read model),
-- emitting EventRedacted / creating redaction rows (the op, 0046), and legal
-- HARD-ERASURE (explicitly out of scope — a separately approved retention/
-- erasure policy and privileged path; documented boundary only). No task
-- lifecycle change; no 0045–0047 objects.
--
-- Redactor identity uses the ratified task_events actor model: redacted_by is a
-- nullable FK (ON DELETE SET NULL) + an immutable redacted_by_display snapshot,
-- and the reject-mutation trigger permits ONLY that FK-driven SET NULL.
--
-- NUMBERING: 0044. Prereq: 0043 (task_events).
-- ============================================================================

-- ── task_events enablers (the sole in-scope task_events changes) ────────────
-- 1) Same-workspace anchor for the overlay's composite FK (event_id is already
--    unique, so this is trivially satisfied by existing rows). Guarded/rerun-safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'task_events_workspace_event_unique'
      and conrelid = 'public.task_events'::regclass
  ) then
    alter table public.task_events
      add constraint task_events_workspace_event_unique unique (workspace_id, event_id);
  end if;
end
$$;

-- 2) Widen the event vocabulary to include EventRedacted (redaction is a logged
--    action). Drop+recreate is rerun-safe; existing rows already conform.
alter table public.task_events drop constraint if exists task_events_event_type_valid;
alter table public.task_events add constraint task_events_event_type_valid check (event_type in (
  'TaskCaptured','TaskTriaged','TaskScheduled','TaskRescheduled','TaskUnscheduled',
  'TaskStarted','TaskBlocked','TaskUnblocked','TaskDeferred','TaskCompleted',
  'TaskReopened','TaskArchived','TaskDropped','TaskRestored',
  'TaskOwnerChanged','TaskAssigned','TaskUnassigned',
  'TaskRenamed','TaskDescriptionEdited','TaskPriorityChanged','TaskDueDateChanged',
  'TaskEstimateChanged','TaskLabeled','TaskUnlabeled',
  'SubtaskAdded','ChecklistItemAdded','ChecklistItemChecked',
  'DependencyAdded','DependencyRemoved','DependencyResolved',
  'RecurringDefinitionCreated','RecurringDefinitionUpdated',
  'RecurringInstanceGenerated','RecurringInstanceMissed',
  'TaskBecameOverdue','ReminderDue',
  'EventRedacted'   -- added in 0044 with the redaction overlay
));

-- ── public.event_redactions ─────────────────────────────────────────────────
create table if not exists public.event_redactions (
  id                 uuid not null default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id),

  target_event_id    uuid,                 -- per-event redaction (composite FK below)
  subject_kind       text,                 -- optional subject-level redaction
  subject_ref        text,

  redacted_fields    text[] not null,      -- which payload paths to suppress/replace
  mode               text not null,
  replacement        text,                 -- masked value when mode=replace

  reason             text not null,
  redacted_by        uuid references public.profiles (id) on delete set null,
  redacted_by_display text not null,       -- immutable identity snapshot
  created_at         timestamptz not null default now(),

  constraint event_redactions_pkey primary key (id),

  -- Same-workspace per-event target (nullable → MATCH SIMPLE skips for
  -- subject-level redactions).
  constraint event_redactions_target_fk
    foreign key (workspace_id, target_event_id)
    references public.task_events (workspace_id, event_id),

  -- Structural guards (all fully null-safe → TRUE/FALSE only).
  constraint event_redactions_mode_valid
    check (mode in ('suppress','replace')),
  constraint event_redactions_mode_replacement
    check ((mode = 'suppress' and replacement is null)
        or (mode = 'replace'  and replacement is not null)),
  constraint event_redactions_reason_nonempty
    check (char_length(trim(reason)) > 0),
  constraint event_redactions_display_nonempty
    check (char_length(trim(redacted_by_display)) > 0),
  constraint event_redactions_fields_nonempty
    check (coalesce(array_length(redacted_fields, 1), 0) >= 1),
  -- subject_kind and subject_ref move together.
  constraint event_redactions_subject_pairing
    check ((subject_kind is null) = (subject_ref is null)),
  -- A redaction must address something: a specific event OR a subject.
  constraint event_redactions_addressing
    check (target_event_id is not null or subject_ref is not null)
);

comment on table public.event_redactions is
  'Privacy redaction overlay for task_events (SERVICE-ROLE write; consumed only '
  'via the 0047 safe read model). Original events are never touched; this overlay '
  'declares which payload fields to suppress/replace. Legal hard-erasure is out '
  'of scope.';

-- ── Append-only overlay: reject content mutation; permit only FK SET NULL ────
-- Same posture as task_events: every DELETE and every content-altering UPDATE is
-- rejected; the ONLY permitted UPDATE is redacted_by non-null -> NULL (profile
-- deletion) with every other column unchanged.
create or replace function public.event_redactions_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'event_redactions is append-only: DELETE is not permitted'
      using errcode = 'BB44A';
  end if;
  if old.redacted_by is not null and new.redacted_by is null
     and new.id                  is not distinct from old.id
     and new.workspace_id        is not distinct from old.workspace_id
     and new.target_event_id     is not distinct from old.target_event_id
     and new.subject_kind        is not distinct from old.subject_kind
     and new.subject_ref         is not distinct from old.subject_ref
     and new.redacted_fields     is not distinct from old.redacted_fields
     and new.mode                is not distinct from old.mode
     and new.replacement         is not distinct from old.replacement
     and new.reason              is not distinct from old.reason
     and new.redacted_by_display is not distinct from old.redacted_by_display
     and new.created_at          is not distinct from old.created_at
  then
    return new;  -- system FK SET NULL only
  end if;
  raise exception 'event_redactions is append-only: UPDATE is not permitted'
    using errcode = 'BB44A';
end;
$$;

drop trigger if exists event_redactions_reject_mutation on public.event_redactions;
create trigger event_redactions_reject_mutation
  before update or delete on public.event_redactions
  for each row
  execute function public.event_redactions_reject_mutation();

-- ── RLS — service-role only, NO policies (consumed via the safe read model) ──
alter table public.event_redactions enable row level security;
alter table public.event_redactions force row level security;

revoke all on public.event_redactions from anon;
revoke all on public.event_redactions from authenticated;
revoke all on public.event_redactions from service_role;
grant insert, select on public.event_redactions to service_role;

-- ── Redaction lookup indexes ────────────────────────────────────────────────
create index if not exists event_redactions_target_idx
  on public.event_redactions (target_event_id);
create index if not exists event_redactions_subject_idx
  on public.event_redactions (subject_kind, subject_ref);
