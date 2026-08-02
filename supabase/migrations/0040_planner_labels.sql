-- ============================================================================
-- Bbettr OS — Planner Tasks: labels + task_labels (B4, migration 0040).
--
-- Reusable, workspace-scoped labels and their task associations (see
-- schema-and-migration-spec.md §10, persistence-architecture.md §9). Labels are
-- ARCHIVED, never hard-deleted, so historical associations stay valid; archived
-- labels drop out of pickers via query filtering, not deletion.
--
-- STRICT SCOPE — this migration creates label STORAGE only: the two tables,
-- their constraints/FKs/indexes, silent-hold immutability triggers, and
-- read-only RLS. It adds NO AddLabel/RemoveLabel command handling, no semantic
-- duplicate-add no-op, no TaskLabeled/TaskUnlabeled events, no task-state logic,
-- and no trigger on tasks/task_blockers/task_dependencies. The task_labels PK
-- provides storage-level duplicate protection only; semantic idempotency arrives
-- with the persistence op (0046). Nothing from 0041–0047 is created.
--
-- NUMBERING: 0040. Prereq: 0037 (tasks + the (workspace_id,id) composite anchor).
-- ============================================================================

-- ── public.labels ───────────────────────────────────────────────────────────
create table if not exists public.labels (
  id           uuid not null default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  name         text not null,
  color_token  text not null,
  archived_at  timestamptz,                       -- archive marker (never deleted)
  created_at   timestamptz not null default now(),

  constraint labels_pkey primary key (id),
  -- Composite-FK anchor so task_labels can reference (workspace_id, id).
  constraint labels_workspace_id_unique unique (workspace_id, id),

  constraint labels_name_nonempty
    check (char_length(trim(name)) > 0),
  -- Bounded decorative palette (visual categorisation tokens only — never CSS,
  -- hex, Tailwind classes, gradients, or semantic app tones).
  constraint labels_color_token_valid
    check (color_token in ('gray','red','orange','amber','green','teal','blue','indigo','purple','pink'))
);

comment on table public.labels is
  'Workspace-scoped task labels (internal admin-only). Archived, never '
  'hard-deleted, so associations stay valid. color_token is a bounded decorative '
  'palette token, not CSS. Read-only via RLS; writes flow through the op (0046).';

-- Full case-insensitive per-workspace name uniqueness (LOCKED: over ALL rows,
-- incl. archived — an archived name stays reserved).
create unique index if not exists labels_workspace_lower_name_idx
  on public.labels (workspace_id, lower(name));

-- Active-label picker.
create index if not exists labels_active_idx
  on public.labels (workspace_id) where archived_at is null;

-- Label immutability — silent-hold (0037–0039 convention). Hold identity +
-- created_at; allow name / color_token / archived_at to change.
create or replace function public.labels_enforce_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.id           := old.id;
    new.workspace_id := old.workspace_id;
    new.created_at   := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists labels_enforce_immutable on public.labels;
create trigger labels_enforce_immutable
  before update on public.labels
  for each row
  execute function public.labels_enforce_immutable();

-- Labels RLS — admin + workspace, read-only.
alter table public.labels enable row level security;
alter table public.labels force row level security;

drop policy if exists labels_select_admin on public.labels;
create policy labels_select_admin
  on public.labels
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

grant select on public.labels to authenticated;
grant all    on public.labels to service_role;
revoke all   on public.labels from anon;

-- ── public.task_labels ──────────────────────────────────────────────────────
-- Identity-only association (no lifecycle columns, no created_at — timing is
-- represented later by TaskLabeled/TaskUnlabeled events).
create table if not exists public.task_labels (
  workspace_id uuid not null,
  task_id      uuid not null,
  label_id     uuid not null,

  constraint task_labels_pkey primary key (task_id, label_id),

  -- Composite FKs make cross-workspace associations structurally impossible.
  -- The label FK targets labels(workspace_id, id) regardless of archived_at, so
  -- an archived label remains a valid target (no cascade-delete on archive).
  constraint task_labels_task_fk
    foreign key (workspace_id, task_id)
    references public.tasks (workspace_id, id),
  constraint task_labels_label_fk
    foreign key (workspace_id, label_id)
    references public.labels (workspace_id, id)
);

comment on table public.task_labels is
  'Task ↔ label associations (internal admin-only). Identity-only; add via '
  'INSERT, remove via DELETE (op, 0046). Cross-workspace associations are '
  'structurally impossible; archived labels remain valid FK targets.';

create index if not exists task_labels_label_idx
  on public.task_labels (label_id);

-- Association immutability — silent-hold all three identity fields to OLD; a
-- row is only added (INSERT) or removed (DELETE), never mutated.
create or replace function public.task_labels_enforce_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.task_id      := old.task_id;
    new.label_id     := old.label_id;
  end if;
  return new;
end;
$$;

drop trigger if exists task_labels_enforce_immutable on public.task_labels;
create trigger task_labels_enforce_immutable
  before update on public.task_labels
  for each row
  execute function public.task_labels_enforce_immutable();

-- task_labels RLS — admin + workspace, read-only.
alter table public.task_labels enable row level security;
alter table public.task_labels force row level security;

drop policy if exists task_labels_select_admin on public.task_labels;
create policy task_labels_select_admin
  on public.task_labels
  for select
  to authenticated
  using (public.is_admin() and workspace_id = public.current_workspace_id());

grant select on public.task_labels to authenticated;
grant all    on public.task_labels to service_role;
revoke all   on public.task_labels from anon;
