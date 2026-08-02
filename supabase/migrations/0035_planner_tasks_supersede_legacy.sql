-- ============================================================================
-- Bbettr OS — Planner Tasks: SUPERSEDE the legacy 0027 schema (B4.1).
--
-- Phase B4.1, first implementation slice of the approved Task Domain. This
-- migration's SOLE responsibility is to safely converge every environment onto
-- a clean slate BEFORE the new Task Domain schema (0036–0047) is built. It
-- creates NO new Tasks schema.
--
-- Background (see docs/planner/schema-and-migration-spec.md §1–§2 and
-- docs/planner/persistence-architecture.md §19–§20):
--   * 0027_planner_tasks.sql remains historically UNTOUCHED (byte-for-byte).
--   * PRODUCTION skipped 0027 — it was never applied there. On production this
--     migration finds no legacy objects and is a safe no-op.
--   * CLEAN / TEST environments may have applied 0027, creating the (empty)
--     legacy Tasks schema. On those this migration removes it completely.
--   * After this migration BOTH database states are identical for all
--     Tasks-related objects: no legacy Tasks schema, and no new Tasks schema
--     yet. Convergence is proven by the schema-parity checks in
--     supabase/tests/tasks-0035-supersession.test.mjs (full 0035–0047 parity
--     is a later CI gate).
--
-- Safety guarantees:
--   * Transactional: the entire body is one DO block; any RAISE rolls back all
--     of its effects. All detection/data checks run BEFORE any DROP.
--   * No legacy data is EVER silently deleted. If the legacy table holds rows,
--     the migration ABORTS (LegacyDataFound) and drops nothing.
--   * Collision-safe. If public.tasks exists but does NOT match the exact legacy
--     0027 fingerprint (e.g. an unrelated or already-upgraded table), the
--     migration ABORTS and drops nothing.
--   * Idempotent / safe to rerun: once the legacy schema is gone (or was never
--     present) the migration is a no-op.
--
-- NUMBERING: 0035.
-- ============================================================================

do $$
declare
  v_table_exists    boolean;
  v_status_ok       boolean;
  v_priority_ok     boolean;
  v_assignee_notnull boolean;
  v_has_workspace   boolean;
  v_has_owner       boolean;
  v_has_version     boolean;
  v_is_legacy       boolean;
  v_row_count       bigint;
begin
  -- ── 1. Detect the presence of public.tasks ──────────────────────────────
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tasks'
  ) into v_table_exists;

  if not v_table_exists then
    -- Production / already-cleaned / never-applied path: nothing to supersede.
    raise notice '0035: no public.tasks table present — legacy supersession is a no-op.';
    return;
  end if;

  -- ── 2. Compute the exact legacy 0027 fingerprint ────────────────────────
  -- Legacy 0027 tasks == status is public.task_status, priority is
  -- public.task_priority, assignee_id is NOT NULL, and NONE of the new-domain
  -- columns (workspace_id / owner_user_id / aggregate_version) exist.
  select
    coalesce(bool_or(column_name = 'status'
      and udt_schema = 'public' and udt_name = 'task_status'), false),
    coalesce(bool_or(column_name = 'priority'
      and udt_schema = 'public' and udt_name = 'task_priority'), false),
    coalesce(bool_or(column_name = 'assignee_id' and is_nullable = 'NO'), false),
    coalesce(bool_or(column_name = 'workspace_id'), false),
    coalesce(bool_or(column_name = 'owner_user_id'), false),
    coalesce(bool_or(column_name = 'aggregate_version'), false)
  into v_status_ok, v_priority_ok, v_assignee_notnull,
       v_has_workspace, v_has_owner, v_has_version
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tasks';

  v_is_legacy :=
        v_status_ok
    and v_priority_ok
    and v_assignee_notnull
    and not v_has_workspace
    and not v_has_owner
    and not v_has_version;

  -- ── 3. Collision safety — never drop an unknown or upgraded tasks table ──
  if not v_is_legacy then
    raise exception
      'TasksTableCollision: public.tasks exists but does NOT match the legacy 0027 fingerprint '
      '(status=task_status:%, priority=task_priority:%, assignee_id NOT NULL:%, '
      'workspace_id present:%, owner_user_id present:%, aggregate_version present:%). '
      'Refusing to drop an unknown or already-upgraded Tasks table. No changes made.',
      v_status_ok, v_priority_ok, v_assignee_notnull,
      v_has_workspace, v_has_owner, v_has_version
      using errcode = 'BB035';
  end if;

  -- ── 4. Data safety — never silently destroy legacy rows ─────────────────
  execute 'select count(*) from public.tasks' into v_row_count;
  if v_row_count > 0 then
    raise exception
      'LegacyDataFound: legacy public.tasks contains % row(s). Investigate and '
      'migrate/remove this data deliberately before superseding — no data was '
      'destroyed and no objects were dropped.',
      v_row_count
      using errcode = 'BB027';
  end if;

  -- ── 5. Empty-legacy cleanup (dependency order; all guarded for rerun) ────
  -- Trigger first (depends on both the table and the function).
  drop trigger if exists tasks_enforce_audit on public.tasks;
  -- Policies (table-owned; explicit for clarity — would also drop with table).
  drop policy if exists tasks_select_admin on public.tasks;
  drop policy if exists tasks_insert_admin on public.tasks;
  drop policy if exists tasks_update_admin on public.tasks;
  -- Indexes (table-owned; explicit for clarity — would also drop with table).
  drop index if exists public.tasks_assignee_idx;
  drop index if exists public.tasks_scheduled_date_idx;
  drop index if exists public.tasks_status_idx;
  drop index if exists public.tasks_assignee_status_idx;
  -- The table (drops any remaining table-owned constraints/indexes/policies).
  drop table if exists public.tasks;
  -- The audit function (now dependency-free once the trigger is gone).
  drop function if exists public.tasks_enforce_audit();
  -- The legacy enum types (only droppable once the table no longer uses them).
  drop type if exists public.task_status;
  drop type if exists public.task_priority;

  raise notice '0035: empty legacy 0027 Tasks schema removed; environment converged.';
end
$$;

-- ── Post-conditions (asserted by the test harness) ──────────────────────────
--   * No public.tasks table remains.
--   * No public.task_status / public.task_priority types remain.
--   * No public.tasks_enforce_audit function or its trigger/policies/indexes.
--   * No new Task-Domain objects were created (0036–0047 build those later).
