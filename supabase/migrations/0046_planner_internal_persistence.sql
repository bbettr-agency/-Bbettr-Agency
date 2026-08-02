-- ============================================================================
-- Bbettr OS — Planner Tasks: internal atomic persistence boundary (B4, 0046).
--
-- The ONE legal writer for the task aggregate. See persistence-architecture.md
-- §16 and schema-and-migration-spec.md §16. This migration creates:
--
--   * public.apply_task_command(jsonb)   — the atomic command-apply operation
--   * public.apply_event_redaction(jsonb)— the append-only redaction overlay op
--
-- SECURITY POSTURE (locked, ruling B):
--   SECURITY INVOKER + `set search_path = public`; EXECUTE revoked from public,
--   anon, authenticated; granted ONLY to service_role. service_role already
--   (a) BYPASSes RLS on the writable tables, and (b) holds only INSERT,SELECT on
--   the append-only engine tables (task_events, event_redactions) — so the op is
--   itself bound by append-only and cannot mutate history. There is no execute
--   path for the browser/authenticated: the boundary is UNREACHABILITY, not an
--   in-function is_admin() re-check.
--
-- OWNERSHIP INVARIANTS (locked):
--   * aggregate_version: the op is the SOLE incrementer. The caller supplies only
--     expected_aggregate_version; the op computes next = current + 1.
--   * event identity: the op owns event_id, aggregate_version, event_sequence
--     (1..N), and occurred_at. The caller owns only event intent (type,
--     schema_version) and sanitized payload.
--   * receipts: success-only ({applied, accepted_noop}); `replayed` is return-only
--     and the replay path NEVER writes/touches/extends a stored receipt.
--
-- TRANSACTION ORDER (locked):
--   receipt lookup → FOR UPDATE task lock → version verify → apply task state →
--   apply satellites → append ordered events → insert success receipt → commit.
--   Any failure rolls back task state, satellites, version, events, AND receipt
--   together. No state without events; no events without state; no receipt
--   without a committed command.
--
-- STRICT SCOPE — persistence capability ONLY. OUT OF SCOPE (deferred, per rulings
-- A/C/D/E): privileged erase / restore-from-erasure; RecurringDefinition*/Missed
-- events (no task aggregate); an EventRedacted task-event (overlay is the audit);
-- reminder task-events (engine state); the recurrence reactor, temporal/reminder
-- evaluators, delivery, APIs, repositories, UI, safe read models. This migration
-- adds NO tables/columns/types/policies and modifies NO prior migration.
--
-- NUMBERING: 0046. Prereqs: 0036–0045.
-- ============================================================================

-- ── Atomic command-apply operation ──────────────────────────────────────────
create or replace function public.apply_task_command(p_envelope jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- ── Structural command/event contract (defensive; TS owns legality) ────────
  -- Per command_type: allowed ordered event-type sequence(s), allowed resulting
  -- status set ('unchanged' = status delta must be ABSENT), and create flag.
  v_contract constant jsonb := $contract$
  {
    "CaptureTask":            {"events":[["TaskCaptured"]],                          "status":["inbox"],                 "create":true},
    "RecurringInstanceGenerated":{"events":[["RecurringInstanceGenerated"]],         "status":["scheduled"],             "create":true},
    "TriageTask":             {"events":[["TaskTriaged"]],                           "status":["planned"]},
    "TriageAndScheduleTask":  {"events":[["TaskTriaged","TaskScheduled"]],           "status":["scheduled"]},
    "ScheduleTask":           {"events":[["TaskScheduled"]],                         "status":["scheduled"]},
    "RescheduleTask":         {"events":[["TaskRescheduled"]],                       "status":["unchanged"]},
    "UnscheduleTask":         {"events":[["TaskUnscheduled"]],                       "status":["planned"]},
    "StartTask":              {"events":[["TaskStarted"]],                           "status":["in_progress"]},
    "BlockTask":              {"events":[["TaskBlocked"]],                           "status":["waiting"]},
    "UnblockTask":            {"events":[["TaskUnblocked"]],                         "status":["planned","scheduled"]},
    "DeferTask":              {"events":[["TaskDeferred"]],                          "status":["scheduled","planned"]},
    "CompleteTask":           {"events":[["TaskCompleted"],["TaskUnblocked","TaskCompleted"]],"status":["completed"]},
    "ReopenTask":             {"events":[["TaskReopened"]],                          "status":["planned","scheduled"]},
    "ArchiveTask":            {"events":[["TaskArchived"]],                          "status":["archived"]},
    "DropTask":               {"events":[["TaskDropped"]],                           "status":["archived"]},
    "RestoreTask":            {"events":[["TaskRestored"]],                          "status":["planned"]},
    "RenameTask":             {"events":[["TaskRenamed"]],                           "status":["unchanged"]},
    "EditDescription":        {"events":[["TaskDescriptionEdited"]],                 "status":["unchanged"]},
    "ChangePriority":         {"events":[["TaskPriorityChanged"]],                   "status":["unchanged"]},
    "ChangeDueDate":          {"events":[["TaskDueDateChanged"]],                    "status":["unchanged"]},
    "ChangeEstimate":         {"events":[["TaskEstimateChanged"]],                   "status":["unchanged"]},
    "ChangeOwner":            {"events":[["TaskOwnerChanged"]],                      "status":["unchanged"]},
    "AssignTask":             {"events":[["TaskAssigned"]],                          "status":["unchanged"]},
    "UnassignTask":           {"events":[["TaskUnassigned"]],                        "status":["unchanged"]},
    "AddLabel":               {"events":[["TaskLabeled"]],                           "status":["unchanged"]},
    "RemoveLabel":            {"events":[["TaskUnlabeled"]],                         "status":["unchanged"]},
    "AddDependency":          {"events":[["DependencyAdded"],["DependencyAdded","TaskBlocked"]],"status":["unchanged","waiting"]},
    "RemoveDependency":       {"events":[["DependencyRemoved"],["DependencyRemoved","TaskUnblocked"]],"status":["unchanged","planned","scheduled"]},
    "DependencyResolved":     {"events":[["DependencyResolved"],["DependencyResolved","TaskUnblocked"]],"status":["unchanged","planned","scheduled"]}
  }
  $contract$::jsonb;

  v_now             constant timestamptz := now();  -- one op instant per command

  v_actor           jsonb := coalesce(p_envelope->'actor', '{}'::jsonb);
  v_actor_kind      text  := v_actor->>'actor_kind';
  v_actor_user_id   uuid  := nullif(v_actor->>'actor_user_id','')::uuid;
  v_actor_ref       text  := v_actor->>'actor_ref';
  v_actor_display   text  := v_actor->>'actor_display';

  v_ws              uuid  := nullif(p_envelope->>'workspace_id','')::uuid;
  v_cmd             text  := p_envelope->>'command_type';
  v_task_id         uuid  := nullif(p_envelope->>'task_id','')::uuid;
  v_expected        int   := nullif(p_envelope->>'expected_aggregate_version','')::int;
  v_idem_key        text  := p_envelope->>'command_idempotency_key';
  v_payload_hash    text  := p_envelope->>'payload_hash';
  v_correlation_id  uuid  := nullif(p_envelope->>'correlation_id','')::uuid;
  v_causation_id    uuid  := nullif(p_envelope->>'causation_id','')::uuid;
  v_deltas          jsonb := coalesce(p_envelope->'task_field_deltas', '{}'::jsonb);
  v_satellite       jsonb := coalesce(p_envelope->'satellite_changes', '[]'::jsonb);
  v_events          jsonb := coalesce(p_envelope->'ordered_events', '[]'::jsonb);
  v_outcome         text  := coalesce(p_envelope->'expected_result'->>'outcome','applied');

  v_spec            jsonb;
  v_is_create       boolean;
  v_actual_events   text[];
  v_status_allowed  text[];
  v_seq_ok          boolean := false;
  v_allowed_seq     jsonb;

  v_task            public.tasks%rowtype;
  v_new_version     int;
  v_new_task_id     uuid;

  v_existing_id     uuid;
  v_existing_ver    int;

  v_chg             jsonb;
  v_op              text;
  v_evt             jsonb;
  v_seq             int;

  v_receipt         record;
begin
  -- ── 0. Minimal envelope guards (DB CHECKs backstop the rest) ──────────────
  if v_ws is null then
    raise exception 'EventContractViolation: workspace_id is required' using errcode = 'BB462';
  end if;
  if v_idem_key is null or char_length(trim(v_idem_key)) = 0 then
    raise exception 'EventContractViolation: command_idempotency_key is required' using errcode = 'BB462';
  end if;
  if v_payload_hash is null or char_length(trim(v_payload_hash)) = 0 then
    raise exception 'EventContractViolation: payload_hash is required' using errcode = 'BB462';
  end if;

  -- ── 1. Structural command/event contract (before any DB effect) ───────────
  v_spec := v_contract -> v_cmd;
  if v_spec is null then
    raise exception 'EventContractViolation: unknown command_type %', coalesce(v_cmd,'<null>')
      using errcode = 'BB462';
  end if;
  v_is_create := coalesce((v_spec->>'create')::boolean, false);

  if jsonb_typeof(v_events) <> 'array' or jsonb_array_length(v_events) = 0 then
    raise exception 'EventContractViolation: at least one ordered event is required (%)', v_cmd
      using errcode = 'BB462';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_events) e
    where coalesce((e->>'event_schema_version')::int, 0) < 1
  ) then
    raise exception 'EventContractViolation: every event needs event_schema_version >= 1'
      using errcode = 'BB462';
  end if;

  -- Actual ordered event-type sequence.
  select array_agg(e->>'event_type' order by ord)
    into v_actual_events
    from jsonb_array_elements(v_events) with ordinality as t(e, ord);

  -- Must match one of the allowed sequences exactly (order + count).
  for v_allowed_seq in select value from jsonb_array_elements(v_spec->'events') loop
    if v_actual_events = (
      select array_agg(x order by ord)
        from jsonb_array_elements_text(v_allowed_seq) with ordinality as s(x, ord)
    ) then
      v_seq_ok := true;
    end if;
  end loop;
  if not v_seq_ok then
    raise exception 'EventContractViolation: event sequence % not permitted for %',
      v_actual_events, v_cmd using errcode = 'BB462';
  end if;

  -- Resulting status category. 'unchanged' sentinel ⇒ status delta must be absent.
  select array_agg(value) into v_status_allowed
    from jsonb_array_elements_text(v_spec->'status');
  if v_deltas ? 'status' then
    if not ((v_deltas->>'status') = any (v_status_allowed)) then
      raise exception 'EventContractViolation: resulting status % not allowed for %',
        v_deltas->>'status', v_cmd using errcode = 'BB462';
    end if;
  else
    if not ('unchanged' = any (v_status_allowed)) then
      raise exception 'EventContractViolation: % requires a resulting status', v_cmd
        using errcode = 'BB462';
    end if;
  end if;

  -- ── 2. Receipt lookup — replay / conflict (NO write on this path) ─────────
  select * into v_receipt
    from public.command_receipts
   where workspace_id = v_ws and idempotency_key = v_idem_key;
  if found then
    if v_receipt.payload_hash is not distinct from v_payload_hash then
      -- Immutable replay: return the stored successful outcome untouched.
      return jsonb_build_object(
        'outcome', 'replayed',
        'stored_outcome', v_receipt.outcome,
        'result_task_id', v_receipt.result_task_id,
        'result_aggregate_version', v_receipt.result_aggregate_version
      );
    end if;
    raise exception 'IdempotencyConflict: key % already used with a different payload', v_idem_key
      using errcode = 'BB461';
  end if;

  -- ── 3a. CREATE branch (CaptureTask, RecurringInstanceGenerated) ───────────
  if v_is_create then
    -- Permanent business idempotency for recurrence generation (independent of
    -- receipt TTL): duplicate (definition, slot) is an accepted no-op.
    if v_cmd = 'RecurringInstanceGenerated' then
      select id, aggregate_version into v_existing_id, v_existing_ver
        from public.tasks
       where workspace_id = v_ws
         and recurrence_definition_id = nullif(v_deltas->>'recurrence_definition_id','')::uuid
         and occurrence_slot = v_deltas->>'occurrence_slot';
      if found then
        insert into public.command_receipts (
          workspace_id, idempotency_key, command_type, payload_hash,
          actor_kind, actor_user_id, actor_ref, result_task_id, result_aggregate_version, outcome
        ) values (
          v_ws, v_idem_key, v_cmd, v_payload_hash,
          v_actor_kind, v_actor_user_id, v_actor_ref, v_existing_id, v_existing_ver, 'accepted_noop'
        );
        return jsonb_build_object(
          'outcome', 'accepted_noop',
          'result_task_id', v_existing_id,
          'result_aggregate_version', v_existing_ver
        );
      end if;
    end if;

    v_new_task_id := coalesce(v_task_id, gen_random_uuid());
    v_new_version := 1;  -- DB CHECK task_events.aggregate_version >= 1 ⇒ 1-based

    insert into public.tasks (
      id, workspace_id, title, description, status, created_by, owner_user_id, assignee_id,
      priority, critical_reason, estimated_minutes, scheduled_date, due_date,
      parent_id, client_id, recurrence_definition_id, occurrence_slot, aggregate_version
    ) values (
      v_new_task_id, v_ws,
      v_deltas->>'title',
      v_deltas->>'description',
      coalesce(v_deltas->>'status','inbox'),
      v_actor_user_id,                                       -- created_by = acting user
      nullif(v_deltas->>'owner_user_id','')::uuid,
      nullif(v_deltas->>'assignee_id','')::uuid,
      coalesce(v_deltas->>'priority','normal'),
      v_deltas->>'critical_reason',
      nullif(v_deltas->>'estimated_minutes','')::int,
      nullif(v_deltas->>'scheduled_date','')::date,
      nullif(v_deltas->>'due_date','')::date,
      nullif(v_deltas->>'parent_id','')::uuid,
      nullif(v_deltas->>'client_id','')::uuid,
      nullif(v_deltas->>'recurrence_definition_id','')::uuid,
      v_deltas->>'occurrence_slot',
      v_new_version
    );
    v_task_id := v_new_task_id;

  -- ── 3b. UPDATE branch (all other commands) ────────────────────────────────
  else
    if v_task_id is null then
      raise exception 'EventContractViolation: task_id is required for %', v_cmd using errcode = 'BB462';
    end if;

    -- Lock the aggregate row for the duration of the command (serialises writers).
    select * into v_task
      from public.tasks
     where workspace_id = v_ws and id = v_task_id
       for update;
    if not found then
      raise exception 'TaskNotFound: no task % in workspace %', v_task_id, v_ws using errcode = 'BB463';
    end if;

    -- Optimistic concurrency: expected must match the CURRENT version.
    if v_expected is null then
      raise exception 'VersionConflict: expected_aggregate_version is required for %', v_cmd
        using errcode = 'BB460';
    end if;
    if v_task.aggregate_version <> v_expected then
      raise exception 'VersionConflict: expected % but task is at %', v_expected, v_task.aggregate_version
        using errcode = 'BB460';
    end if;

    -- Apply ONLY whitelisted task-field deltas (key-present semantics; JSON null
    -- clears the column, e.g. Unassign). No dynamic SQL, no caller column names.
    if v_deltas ? 'title'                    then v_task.title                    := v_deltas->>'title'; end if;
    if v_deltas ? 'description'              then v_task.description              := v_deltas->>'description'; end if;
    if v_deltas ? 'status'                   then v_task.status                   := v_deltas->>'status'; end if;
    if v_deltas ? 'owner_user_id'            then v_task.owner_user_id            := nullif(v_deltas->>'owner_user_id','')::uuid; end if;
    if v_deltas ? 'assignee_id'              then v_task.assignee_id              := nullif(v_deltas->>'assignee_id','')::uuid; end if;
    if v_deltas ? 'priority'                 then v_task.priority                 := v_deltas->>'priority'; end if;
    if v_deltas ? 'critical_reason'          then v_task.critical_reason          := v_deltas->>'critical_reason'; end if;
    if v_deltas ? 'estimated_minutes'        then v_task.estimated_minutes        := nullif(v_deltas->>'estimated_minutes','')::int; end if;
    if v_deltas ? 'scheduled_date'           then v_task.scheduled_date           := nullif(v_deltas->>'scheduled_date','')::date; end if;
    if v_deltas ? 'due_date'                 then v_task.due_date                 := nullif(v_deltas->>'due_date','')::date; end if;
    if v_deltas ? 'resume_target'            then v_task.resume_target            := nullif(v_deltas->>'resume_target',''); end if;
    if v_deltas ? 'parent_id'                then v_task.parent_id                := nullif(v_deltas->>'parent_id','')::uuid; end if;
    if v_deltas ? 'client_id'                then v_task.client_id                := nullif(v_deltas->>'client_id','')::uuid; end if;
    if v_deltas ? 'recurrence_definition_id' then v_task.recurrence_definition_id := nullif(v_deltas->>'recurrence_definition_id','')::uuid; end if;
    if v_deltas ? 'occurrence_slot'          then v_task.occurrence_slot          := nullif(v_deltas->>'occurrence_slot',''); end if;

    -- Protected-field derivation (op-owned; never from the envelope), keyed by
    -- command_type + op now(). aggregate_version increments exactly once.
    v_task.aggregate_version := v_task.aggregate_version + 1;
    case v_cmd
      when 'StartTask' then
        v_task.started_at := coalesce(v_task.started_at, v_now);   -- set-once
      when 'CompleteTask' then
        v_task.completed_at := v_now;
        v_task.completed_by := v_actor_user_id;
      when 'ReopenTask' then
        v_task.completed_at := null;
        v_task.completed_by := null;
      when 'ArchiveTask' then                                       -- retention
        v_task.archived_at := v_now;
        v_task.archive_reason := 'retention';                       -- completion preserved
      when 'DropTask' then                                          -- cancelled
        v_task.archived_at := v_now;
        v_task.archive_reason := 'cancelled';
        v_task.completed_at := null;
        v_task.completed_by := null;
      when 'RestoreTask' then
        v_task.archived_at := null;
        v_task.archive_reason := null;
        v_task.completed_at := null;
        v_task.completed_by := null;
        v_task.started_at := null;
        v_task.scheduled_date := null;                              -- Restore → Planned, undated
      else
        null;
    end case;

    -- Apply bounded satellite changes (may create blocker/dependency rows the
    -- Waiting summary depends on).
    for v_chg in select value from jsonb_array_elements(v_satellite) loop
      v_op := v_chg->>'op';
      case v_op
        when 'blocker_add' then
          insert into public.task_blockers (
            workspace_id, task_id, blocker_class, blocker_key,
            reference_user_id, reference_task_id, reference_client_id, reason
          )
          select v_ws, v_task_id, v_chg->>'blocker_class', v_chg->>'blocker_key',
                 nullif(v_chg->>'reference_user_id','')::uuid,
                 nullif(v_chg->>'reference_task_id','')::uuid,
                 nullif(v_chg->>'reference_client_id','')::uuid,
                 v_chg->>'reason'
          where not exists (
            select 1 from public.task_blockers b
             where b.task_id = v_task_id
               and b.blocker_class = v_chg->>'blocker_class'
               and b.blocker_key = v_chg->>'blocker_key'
               and b.resolved_at is null
          );
        when 'blocker_resolve' then
          update public.task_blockers
             set resolved_at = v_now
           where task_id = v_task_id
             and blocker_key = v_chg->>'blocker_key'
             and resolved_at is null;
        when 'dependency_add' then
          insert into public.task_dependencies (workspace_id, dependent_id, prerequisite_id, kind)
          select v_ws, v_task_id, (v_chg->>'prerequisite_id')::uuid, v_chg->>'kind'
          where not exists (
            select 1 from public.task_dependencies d
             where d.dependent_id = v_task_id
               and d.prerequisite_id = (v_chg->>'prerequisite_id')::uuid
               and d.kind = v_chg->>'kind'
               and d.resolved_at is null and d.removed_at is null
          );
        when 'dependency_resolve' then
          update public.task_dependencies
             set resolved_at = v_now
           where dependent_id = v_task_id
             and prerequisite_id = (v_chg->>'prerequisite_id')::uuid
             and kind = v_chg->>'kind'
             and resolved_at is null and removed_at is null;
        when 'dependency_remove' then
          update public.task_dependencies
             set removed_at = v_now,
                 removal_reason = coalesce(nullif(v_chg->>'removal_reason',''), 'removed')
           where dependent_id = v_task_id
             and prerequisite_id = (v_chg->>'prerequisite_id')::uuid
             and kind = v_chg->>'kind'
             and resolved_at is null and removed_at is null;
        when 'label_add' then
          if exists (
            select 1 from public.labels l
             where l.workspace_id = v_ws
               and l.id = (v_chg->>'label_id')::uuid
               and l.archived_at is not null
          ) then
            raise exception 'ArchivedLabel: label % is archived and cannot be associated', v_chg->>'label_id'
              using errcode = 'BB465';
          end if;
          insert into public.task_labels (workspace_id, task_id, label_id)
          values (v_ws, v_task_id, (v_chg->>'label_id')::uuid)
          on conflict (task_id, label_id) do nothing;
        when 'label_remove' then
          delete from public.task_labels
           where task_id = v_task_id and label_id = (v_chg->>'label_id')::uuid;
        else
          raise exception 'EventContractViolation: unknown satellite op %', coalesce(v_op,'<null>')
            using errcode = 'BB462';
      end case;
    end loop;

    -- Recompute the Waiting summary from active blockers (op-owned, never caller).
    if v_task.status = 'waiting' then
      v_task.blocked_since := (
        select min(created_at) from public.task_blockers
         where workspace_id = v_ws and task_id = v_task_id and resolved_at is null
      );
    else
      v_task.blocked_since := null;
      v_task.resume_target := null;
    end if;

    v_new_version := v_task.aggregate_version;

    -- Persist the mutated aggregate. created_by/created_at/id/workspace_id are held
    -- immutable and updated_at is stamped by the tasks_enforce_audit trigger.
    update public.tasks t set
      title                    = v_task.title,
      description              = v_task.description,
      status                   = v_task.status,
      owner_user_id            = v_task.owner_user_id,
      assignee_id              = v_task.assignee_id,
      priority                 = v_task.priority,
      critical_reason          = v_task.critical_reason,
      estimated_minutes        = v_task.estimated_minutes,
      scheduled_date           = v_task.scheduled_date,
      due_date                 = v_task.due_date,
      started_at               = v_task.started_at,
      completed_at             = v_task.completed_at,
      completed_by             = v_task.completed_by,
      archived_at              = v_task.archived_at,
      archive_reason           = v_task.archive_reason,
      blocked_since            = v_task.blocked_since,
      resume_target            = v_task.resume_target,
      aggregate_version        = v_task.aggregate_version,
      parent_id                = v_task.parent_id,
      client_id                = v_task.client_id,
      recurrence_definition_id = v_task.recurrence_definition_id,
      occurrence_slot          = v_task.occurrence_slot
    where t.workspace_id = v_ws and t.id = v_task_id;
  end if;

  -- ── 4. Append the ordered events at the new version (op owns identity) ─────
  v_seq := 0;
  for v_evt in select value from jsonb_array_elements(v_events) loop
    v_seq := v_seq + 1;
    insert into public.task_events (
      workspace_id, task_id, aggregate_version, event_sequence, event_type, event_schema_version,
      actor_kind, actor_user_id, actor_ref, actor_display, occurred_at,
      correlation_id, causation_id, command_idempotency_key, payload
    ) values (
      v_ws, v_task_id, v_new_version, v_seq, v_evt->>'event_type', (v_evt->>'event_schema_version')::int,
      v_actor_kind, v_actor_user_id, v_actor_ref, v_actor_display, v_now,
      v_correlation_id, v_causation_id, v_idem_key, coalesce(v_evt->'payload', '{}'::jsonb)
    );
  end loop;

  -- ── 5. Write the success-only receipt (applied | accepted_noop) ───────────
  if v_outcome not in ('applied','accepted_noop') then
    raise exception 'EventContractViolation: receipt outcome % is not storable', v_outcome
      using errcode = 'BB462';
  end if;
  insert into public.command_receipts (
    workspace_id, idempotency_key, command_type, payload_hash,
    actor_kind, actor_user_id, actor_ref, result_task_id, result_aggregate_version, outcome
  ) values (
    v_ws, v_idem_key, v_cmd, v_payload_hash,
    v_actor_kind, v_actor_user_id, v_actor_ref, v_task_id, v_new_version, v_outcome
  );

  -- ── 6. Return the committed outcome ───────────────────────────────────────
  return jsonb_build_object(
    'outcome', v_outcome,
    'result_task_id', v_task_id,
    'result_aggregate_version', v_new_version
  );
end;
$$;

comment on function public.apply_task_command(jsonb) is
  'INTERNAL-ONLY atomic task-command persistence boundary (SECURITY INVOKER; '
  'service_role EXECUTE only). One transaction: receipt lookup/replay → FOR '
  'UPDATE lock → version check → whitelisted task deltas + bounded satellites → '
  'op-derived protected fields → single aggregate_version increment → ordered '
  'events (op-owned id/seq/occurred_at) → success-only receipt. The sole writer '
  'of the task aggregate; the caller never supplies version or event identity.';

-- ── Append-only redaction overlay op (overlay is the audit; no task-event) ──
create or replace function public.apply_event_redaction(p_envelope jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ws          uuid  := nullif(p_envelope->>'workspace_id','')::uuid;
  v_target      uuid  := nullif(p_envelope->>'target_event_id','')::uuid;
  v_subj_kind   text  := nullif(p_envelope->>'subject_kind','');
  v_subj_ref    text  := nullif(p_envelope->>'subject_ref','');
  v_fields      text[] := array(select jsonb_array_elements_text(coalesce(p_envelope->'redacted_fields','[]'::jsonb)));
  v_mode        text  := p_envelope->>'mode';
  v_replacement text  := p_envelope->>'replacement';
  v_reason      text  := p_envelope->>'reason';
  v_actor       jsonb := coalesce(p_envelope->'actor','{}'::jsonb);
  v_redactor    uuid  := nullif(v_actor->>'actor_user_id','')::uuid;
  v_display     text  := v_actor->>'actor_display';
  v_id          uuid;
begin
  if v_ws is null then
    raise exception 'EventContractViolation: workspace_id is required' using errcode = 'BB462';
  end if;
  -- Insert the append-only overlay. Same-workspace target enforced by the
  -- composite FK; the original task_events row is never touched.
  insert into public.event_redactions (
    workspace_id, target_event_id, subject_kind, subject_ref,
    redacted_fields, mode, replacement, reason, redacted_by, redacted_by_display
  ) values (
    v_ws, v_target, v_subj_kind, v_subj_ref,
    v_fields, v_mode, v_replacement, v_reason, v_redactor, v_display
  )
  returning id into v_id;

  return jsonb_build_object('outcome', 'applied', 'redaction_id', v_id);
end;
$$;

comment on function public.apply_event_redaction(jsonb) is
  'INTERNAL-ONLY redaction overlay writer (SECURITY INVOKER; service_role EXECUTE '
  'only). Appends an event_redactions row; NEVER mutates the target task_events '
  'row and emits NO task-event (the overlay itself is the audit trail).';

-- ── Execute grants: internal-only, service_role exclusively (ruling B) ───────
revoke all on function public.apply_task_command(jsonb)    from public;
revoke all on function public.apply_task_command(jsonb)    from anon;
revoke all on function public.apply_task_command(jsonb)    from authenticated;
grant  execute on function public.apply_task_command(jsonb) to service_role;

revoke all on function public.apply_event_redaction(jsonb)    from public;
revoke all on function public.apply_event_redaction(jsonb)    from anon;
revoke all on function public.apply_event_redaction(jsonb)    from authenticated;
grant  execute on function public.apply_event_redaction(jsonb) to service_role;
