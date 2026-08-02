-- ============================================================================
-- Bbettr OS — Planner Tasks: safe read models (B4, migration 0047).
--
-- The ONLY human-facing read surface over the engine tables. See
-- persistence-architecture.md §17 and schema-and-migration-spec.md §17/§18.
-- Two SECURITY DEFINER functions, each doing its OWN explicit, fail-closed
-- authorization (never relying on base-table RLS under DEFINER):
--
--   * public.read_task_events(task, after_version, after_seq, limit)
--       — per-task event history: a conservative, redaction-aware projection.
--   * public.read_task_reminders(task)
--       — minimal reminder INTENT (id, task, remind_at, state, created_at).
--
-- SECURITY (locked): SECURITY DEFINER + `set search_path = public`; in-function
-- auth.uid() present → is_admin() → current_workspace_id() (fail-closed) →
-- every row constrained to that workspace. EXECUTE revoked from public/anon;
-- granted ONLY to authenticated. Raw task_events, event_redactions and
-- task_reminders stay service-role-only — unreadable to authenticated (incl.
-- admins); these functions are the sole surface. Static SQL only.
--
-- CONSERVATIVE v1 PROJECTION (locked): event_id, occurred_at, event_type,
-- aggregate_version, event_sequence, actor_display, a server-generated summary,
-- and a small explicitly-whitelisted set of scalar payload values. NEVER: raw
-- payload JSON, correlation/causation ids, secrets, provider data, or arbitrary
-- before/after objects. Redactions (event-level AND subject-level) mask/suppress
-- matching fields before anything is returned; original task_events rows are
-- never touched.
--
-- STRICT SCOPE — read functions ONLY. No write path, no UI/APIs/repositories/
-- services/automation/scheduler/evaluator/delivery/reporting, no workspace-wide
-- feed, no recurrence logic. No table/column/policy/grant added to the engine
-- tables. No prior migration modified.
--
-- NUMBERING: 0047. Prereqs: 0043 (task_events), 0044 (event_redactions),
-- 0042 (task_reminders), 0036 (workspaces / current_workspace_id).
-- ============================================================================

-- ── Safe per-task event history ─────────────────────────────────────────────
create or replace function public.read_task_events(
  p_task_id       uuid,
  p_after_version int  default null,   -- keyset cursor: last seen aggregate_version
  p_after_seq     int  default null,   -- keyset cursor: last seen event_sequence
  p_limit         int  default 200     -- normalized into [1, 200]
)
returns table (
  event_id          uuid,
  occurred_at       timestamptz,
  event_type        text,
  aggregate_version int,
  event_sequence    int,
  actor_display     text,
  summary           text,
  details           jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  -- Explicitly whitelisted, non-PII scalar payload keys. Anything else in the
  -- payload (including nested objects and unknown keys) is NEVER exposed.
  v_whitelist constant text[] := array[
    'from_status','to_status','from_priority','to_priority','priority',
    'reason','resume_target','blocker_class','kind','due_date','scheduled_date'
  ];
  v_ws       uuid;
  v_limit    int;
  v_uid      uuid := auth.uid();
  e          record;
  red        record;
  v_details  jsonb;
  v_actor    text;
  v_key      text;
  v_fld      text;
begin
  -- ── Fail-closed authorization (never trusts base-table RLS) ───────────────
  if v_uid is null then
    raise exception 'NotAuthenticated: an authenticated actor is required'
      using errcode = 'BB471';
  end if;
  if not public.is_admin() then
    raise exception 'NotAuthorized: admin role required'
      using errcode = 'BB472';
  end if;
  v_ws := public.current_workspace_id();
  if v_ws is null then
    raise exception 'NoWorkspace: the actor has no resolved workspace'
      using errcode = 'BB473';
  end if;

  -- Normalize the page size into a hard [1, 200] band (excessive → 200).
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 200);

  -- Deterministic keyset page, strictly workspace-scoped.
  for e in
    select te.event_id, te.occurred_at, te.event_type, te.aggregate_version,
           te.event_sequence, te.actor_display, te.actor_user_id, te.payload
      from public.task_events te
     where te.task_id = p_task_id
       and te.workspace_id = v_ws
       and (te.aggregate_version, te.event_sequence)
           > (coalesce(p_after_version, 0), coalesce(p_after_seq, 0))
     order by te.aggregate_version, te.event_sequence
     limit v_limit
  loop
    -- Build the whitelisted scalar projection (scalars only; no objects).
    v_details := '{}'::jsonb;
    foreach v_key in array v_whitelist loop
      if e.payload ? v_key and jsonb_typeof(e.payload -> v_key) in ('string','number','boolean') then
        v_details := v_details || jsonb_build_object(v_key, e.payload -> v_key);
      end if;
    end loop;

    v_actor := e.actor_display;

    -- Apply redaction overlays (event-level by event id; subject-level by the
    -- event's actor). Suppress removes the field; replace masks it. Original
    -- task_events rows are untouched — this is a read-time projection only.
    for red in
      select r.redacted_fields, r.mode, r.replacement
        from public.event_redactions r
       where r.workspace_id = v_ws
         and ( r.target_event_id = e.event_id
            or ( r.subject_ref is not null
                 and e.actor_user_id is not null
                 and r.subject_ref = e.actor_user_id::text ) )
       order by r.created_at, r.id
    loop
      foreach v_fld in array red.redacted_fields loop
        if v_fld = 'actor_display' then
          v_actor := case when red.mode = 'suppress' then null else red.replacement end;
        elsif v_details ? v_fld then
          if red.mode = 'suppress' then
            v_details := v_details - v_fld;
          else
            v_details := jsonb_set(v_details, array[v_fld], to_jsonb(red.replacement));
          end if;
        end if;
      end loop;
    end loop;

    -- Concise, controlled, non-PII summary (static label + at most one
    -- whitelisted status/priority scalar). Never leaks redactable identity.
    event_id          := e.event_id;
    occurred_at       := e.occurred_at;
    event_type        := e.event_type;
    aggregate_version := e.aggregate_version;
    event_sequence    := e.event_sequence;
    actor_display     := v_actor;
    details           := v_details;
    summary := case e.event_type
      when 'TaskCaptured'           then 'Task captured'
      when 'TaskTriaged'            then 'Task triaged'
      when 'TaskScheduled'          then 'Task scheduled'
      when 'TaskRescheduled'        then 'Task rescheduled'
      when 'TaskUnscheduled'        then 'Task unscheduled'
      when 'TaskStarted'            then 'Task started'
      when 'TaskBlocked'            then 'Task blocked'
      when 'TaskUnblocked'          then 'Task unblocked'
      when 'TaskDeferred'           then 'Task deferred'
      when 'TaskCompleted'          then 'Task completed'
      when 'TaskReopened'           then 'Task reopened'
      when 'TaskArchived'           then 'Task archived'
      when 'TaskDropped'            then 'Task dropped'
      when 'TaskRestored'           then 'Task restored'
      when 'TaskOwnerChanged'       then 'Owner changed'
      when 'TaskAssigned'           then 'Task assigned'
      when 'TaskUnassigned'         then 'Task unassigned'
      when 'TaskRenamed'            then 'Task renamed'
      when 'TaskDescriptionEdited'  then 'Description edited'
      when 'TaskPriorityChanged'    then 'Priority changed'
        || coalesce(' to ' || (e.payload ->> 'to_priority'), '')
      when 'TaskDueDateChanged'     then 'Due date changed'
      when 'TaskEstimateChanged'    then 'Estimate changed'
      when 'TaskLabeled'            then 'Label added'
      when 'TaskUnlabeled'          then 'Label removed'
      when 'DependencyAdded'        then 'Dependency added'
      when 'DependencyRemoved'      then 'Dependency removed'
      when 'DependencyResolved'     then 'Dependency resolved'
      when 'RecurringInstanceGenerated' then 'Recurring instance generated'
      else e.event_type   -- fixed vocabulary; safe, non-PII fallback
    end;
    return next;
  end loop;

  return;
end;
$$;

comment on function public.read_task_events(uuid,int,int,int) is
  'Admin+workspace-scoped SAFE per-task event history (SECURITY DEFINER, '
  'authenticated EXECUTE only). Fail-closed authz; conservative whitelisted '
  'projection + server summary; event- and subject-level redactions applied; '
  'keyset pagination on (aggregate_version, event_sequence), limit capped at 200. '
  'Never returns raw payload/correlation/causation. Raw task_events stays hidden.';

-- ── Safe reminder intent (engine internals hidden) ──────────────────────────
create or replace function public.read_task_reminders(p_task_id uuid)
returns table (
  id          uuid,
  task_id     uuid,
  remind_at   timestamptz,
  state       text,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ws  uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NotAuthenticated: an authenticated actor is required'
      using errcode = 'BB471';
  end if;
  if not public.is_admin() then
    raise exception 'NotAuthorized: admin role required'
      using errcode = 'BB472';
  end if;
  v_ws := public.current_workspace_id();
  if v_ws is null then
    raise exception 'NoWorkspace: the actor has no resolved workspace'
      using errcode = 'BB473';
  end if;

  -- Only safe intent columns; claim_token/claimed_at/attempts/last_error/
  -- dedupe_key/delivered_at (engine + provider internals) are never selected.
  return query
    select tr.id, tr.task_id, tr.remind_at, tr.state, tr.created_at
      from public.task_reminders tr
     where tr.task_id = p_task_id
       and tr.workspace_id = v_ws
     order by tr.remind_at, tr.id;
end;
$$;

comment on function public.read_task_reminders(uuid) is
  'Admin+workspace-scoped SAFE reminder INTENT (SECURITY DEFINER, authenticated '
  'EXECUTE only). Exposes id/task_id/remind_at/state/created_at only; engine and '
  'provider internals stay hidden. Raw task_reminders remains inaccessible.';

-- ── Execute grants: authenticated only; raw engine tables stay hidden ────────
revoke all on function public.read_task_events(uuid,int,int,int)  from public;
revoke all on function public.read_task_events(uuid,int,int,int)  from anon;
grant  execute on function public.read_task_events(uuid,int,int,int) to authenticated;

revoke all on function public.read_task_reminders(uuid) from public;
revoke all on function public.read_task_reminders(uuid) from anon;
grant  execute on function public.read_task_reminders(uuid) to authenticated;
