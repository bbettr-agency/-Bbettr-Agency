/**
 * Pure Planner-Tasks lifecycle state machine — the SOLE application-level
 * authority on transition legality.
 *
 * Dependency-free: no database, no auth, no env, no ambient clock, no network.
 * `evaluate` takes a bounded command, an optional current-task snapshot, and an
 * optional context (an injected agency-local `today` for the one command that
 * needs it), and returns a controlled `CommandPlan` — resulting status, the
 * whitelisted task deltas, ordered events, and bounded satellite changes — or
 * THROWS a typed `TaskError`. It never accepts arbitrary event arrays or
 * arbitrary column patches; every plan is constructed here from the command.
 *
 * Graph invariants that require data the snapshot does not carry (ActiveChildren,
 * DependencyCycle) are enforced by the DB trigger backstops and surface via
 * `mapDbError`; this module owns status→status legality and owner/assignee guards.
 */
import type {
  ActorKind,
  ArchiveReason,
  DependencyKind,
  OrderedEventInput,
  ResumeTarget,
  SatelliteChange,
  TaskFieldDeltas,
  TaskPriority,
  TaskStatus,
} from "@/lib/database.types";
import { TaskError } from "./errors";

export interface TaskSnapshot {
  id: string;
  status: TaskStatus;
  owner_user_id: string | null;
  assignee_id: string | null;
  priority: TaskPriority;
  resume_target: ResumeTarget | null;
  scheduled_date: string | null;
  aggregate_version: number;
}

export interface BlockerInput {
  blocker_class: "person" | "client" | "approval" | "asset" | "dependency";
  blocker_key: string;
  reference_user_id?: string | null;
  reference_task_id?: string | null;
  reference_client_id?: string | null;
  reason?: string | null;
}

/** The bounded command union C1 supports (lifecycle + attribute + label + dependency). */
export type TaskCommand =
  | { type: "CaptureTask"; title: string; priority?: TaskPriority }
  | { type: "TriageTask"; owner_user_id: string; priority?: TaskPriority }
  | { type: "TriageAndScheduleTask"; owner_user_id: string; scheduled_date: string; assignee_id?: string | null; priority?: TaskPriority }
  | { type: "ScheduleTask"; scheduled_date: string }
  | { type: "RescheduleTask"; scheduled_date: string }
  | { type: "UnscheduleTask" }
  | { type: "StartTask"; assignee_id?: string }
  | { type: "BlockTask"; blocker: BlockerInput }
  | { type: "UnblockTask"; resolve_blocker_keys?: string[] }
  | { type: "DeferTask"; to: "scheduled" | "planned"; scheduled_date?: string }
  | { type: "CompleteTask"; resolve_blocker_keys?: string[] }
  | { type: "ReopenTask" }
  | { type: "ArchiveTask" }
  | { type: "DropTask" }
  | { type: "RestoreTask" }
  | { type: "RenameTask"; title: string }
  | { type: "EditDescription"; description: string | null }
  | { type: "ChangePriority"; priority: TaskPriority; critical_reason?: string | null }
  | { type: "ChangeDueDate"; due_date: string | null }
  | { type: "ChangeEstimate"; estimated_minutes: number | null }
  | { type: "ChangeOwner"; owner_user_id: string }
  | { type: "AssignTask"; assignee_id: string }
  | { type: "UnassignTask" }
  | { type: "AddLabel"; label_id: string }
  | { type: "RemoveLabel"; label_id: string }
  | { type: "AddDependency"; prerequisite_id: string; kind: DependencyKind }
  | { type: "RemoveDependency"; prerequisite_id: string; kind: DependencyKind; removal_reason?: string | null };

export interface CommandPlan {
  command_type: TaskCommand["type"];
  is_create: boolean;
  /** The resulting lifecycle status, or "unchanged" for attribute-only commands. */
  resulting_status: TaskStatus | "unchanged";
  task_field_deltas: TaskFieldDeltas;
  ordered_events: OrderedEventInput[];
  satellite_changes: SatelliteChange[];
  /** Actor kind the resulting events/receipt should carry (always a user in C1). */
  actor_kind: ActorKind;
}

export interface EvaluateContext {
  /** Agency-local (Africa/Johannesburg) YYYY-MM-DD; required for StartTask from Planned. */
  today?: string;
}

const ACTIVE: TaskStatus[] = ["inbox", "planned", "scheduled", "in_progress", "waiting"];
const ACTIONABLE: TaskStatus[] = ["planned", "scheduled", "in_progress"];

const ev = (type: OrderedEventInput["event_type"], payload: Record<string, string | number | boolean | null> = {}): OrderedEventInput => ({
  event_type: type,
  event_schema_version: 1,
  payload,
});

const requireSnapshot = (snapshot: TaskSnapshot | null | undefined): TaskSnapshot => {
  if (!snapshot) throw new TaskError("TaskNotFound");
  return snapshot;
};

const assertFrom = (status: TaskStatus, allowed: TaskStatus[]): void => {
  if (!allowed.includes(status)) throw new TaskError("IllegalTransition");
};

const assertNotArchived = (status: TaskStatus): void => {
  if (status === "archived") throw new TaskError("IllegalTransition");
};

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/** Resume target when leaving an actionable state (never resumes to In Progress). */
const resumeTargetFor = (status: TaskStatus): ResumeTarget =>
  status === "in_progress" ? "scheduled" : status === "planned" ? "planned" : "scheduled";

export function evaluate(
  command: TaskCommand,
  snapshot?: TaskSnapshot | null,
  ctx?: EvaluateContext
): CommandPlan {
  const base = { actor_kind: "user" as ActorKind };

  switch (command.type) {
    // ── Create ────────────────────────────────────────────────────────────
    case "CaptureTask": {
      if (!nonEmpty(command.title)) throw new TaskError("InvalidCommand");
      const deltas: TaskFieldDeltas = { title: command.title, status: "inbox" };
      if (command.priority) deltas.priority = command.priority;
      return { ...base, command_type: command.type, is_create: true, resulting_status: "inbox", task_field_deltas: deltas, ordered_events: [ev("TaskCaptured", { title: command.title })], satellite_changes: [] };
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    case "TriageTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["inbox"]);
      if (!nonEmpty(command.owner_user_id)) throw new TaskError("MissingOwner");
      const deltas: TaskFieldDeltas = { status: "planned", owner_user_id: command.owner_user_id };
      if (command.priority) deltas.priority = command.priority;
      return { ...base, command_type: command.type, is_create: false, resulting_status: "planned", task_field_deltas: deltas, ordered_events: [ev("TaskTriaged")], satellite_changes: [] };
    }
    case "TriageAndScheduleTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["inbox"]);
      if (!nonEmpty(command.owner_user_id)) throw new TaskError("MissingOwner");
      if (!nonEmpty(command.scheduled_date)) throw new TaskError("InvalidCommand");
      const deltas: TaskFieldDeltas = {
        status: "scheduled",
        owner_user_id: command.owner_user_id,
        scheduled_date: command.scheduled_date,
        assignee_id: command.assignee_id ?? null, // explicit assignee policy
      };
      if (command.priority) deltas.priority = command.priority;
      return { ...base, command_type: command.type, is_create: false, resulting_status: "scheduled", task_field_deltas: deltas, ordered_events: [ev("TaskTriaged"), ev("TaskScheduled", { scheduled_date: command.scheduled_date })], satellite_changes: [] };
    }
    case "ScheduleTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["planned"]);
      if (!nonEmpty(command.scheduled_date)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "scheduled", task_field_deltas: { status: "scheduled", scheduled_date: command.scheduled_date }, ordered_events: [ev("TaskScheduled", { scheduled_date: command.scheduled_date })], satellite_changes: [] };
    }
    case "RescheduleTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["scheduled"]);
      if (!nonEmpty(command.scheduled_date)) throw new TaskError("InvalidCommand");
      // Status unchanged (stays scheduled) — no status delta.
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { scheduled_date: command.scheduled_date }, ordered_events: [ev("TaskRescheduled", { scheduled_date: command.scheduled_date })], satellite_changes: [] };
    }
    case "UnscheduleTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["scheduled"]);
      return { ...base, command_type: command.type, is_create: false, resulting_status: "planned", task_field_deltas: { status: "planned", scheduled_date: null }, ordered_events: [ev("TaskUnscheduled")], satellite_changes: [] };
    }
    case "StartTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["planned", "scheduled"]); // never directly from waiting
      const assignee = command.assignee_id ?? s.assignee_id;
      if (!nonEmpty(assignee)) throw new TaskError("MissingAssignee");
      const deltas: TaskFieldDeltas = { status: "in_progress", assignee_id: assignee };
      if (s.status === "planned") {
        if (!nonEmpty(ctx?.today)) throw new TaskError("InvalidCommand");
        deltas.scheduled_date = ctx.today; // auto-schedule to today (single TaskStarted event)
      }
      return { ...base, command_type: command.type, is_create: false, resulting_status: "in_progress", task_field_deltas: deltas, ordered_events: [ev("TaskStarted")], satellite_changes: [] };
    }
    case "BlockTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["planned", "scheduled", "in_progress"]);
      const b = command.blocker;
      if (!b || !nonEmpty(b.blocker_class) || !nonEmpty(b.blocker_key)) throw new TaskError("InvalidCommand");
      const resume_target = resumeTargetFor(s.status);
      return {
        ...base, command_type: command.type, is_create: false, resulting_status: "waiting",
        task_field_deltas: { status: "waiting", resume_target },
        satellite_changes: [{ op: "blocker_add", blocker_class: b.blocker_class, blocker_key: b.blocker_key, reference_user_id: b.reference_user_id ?? null, reference_task_id: b.reference_task_id ?? null, reference_client_id: b.reference_client_id ?? null, reason: b.reason ?? null }],
        ordered_events: [ev("TaskBlocked")],
      };
    }
    case "UnblockTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["waiting"]);
      const target = s.resume_target;
      if (!target) throw new TaskError("InvalidCommand");
      return {
        ...base, command_type: command.type, is_create: false, resulting_status: target,
        task_field_deltas: { status: target },
        satellite_changes: (command.resolve_blocker_keys ?? []).map((k) => ({ op: "blocker_resolve", blocker_key: k })),
        ordered_events: [ev("TaskUnblocked")],
      };
    }
    case "DeferTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["in_progress"]);
      if (command.to !== "scheduled" && command.to !== "planned") throw new TaskError("InvalidCommand");
      const deltas: TaskFieldDeltas = { status: command.to };
      if (command.to === "scheduled" && nonEmpty(command.scheduled_date)) deltas.scheduled_date = command.scheduled_date;
      return { ...base, command_type: command.type, is_create: false, resulting_status: command.to, task_field_deltas: deltas, ordered_events: [ev("TaskDeferred")], satellite_changes: [] };
    }
    case "CompleteTask": {
      const s = requireSnapshot(snapshot);
      if (s.status === "waiting") {
        // Atomic unblock-then-complete: TaskUnblocked (seq 1) then TaskCompleted (seq 2).
        return {
          ...base, command_type: command.type, is_create: false, resulting_status: "completed",
          task_field_deltas: { status: "completed" },
          satellite_changes: (command.resolve_blocker_keys ?? []).map((k) => ({ op: "blocker_resolve", blocker_key: k })),
          ordered_events: [ev("TaskUnblocked"), ev("TaskCompleted")],
        };
      }
      assertFrom(s.status, ["planned", "scheduled", "in_progress"]);
      return { ...base, command_type: command.type, is_create: false, resulting_status: "completed", task_field_deltas: { status: "completed" }, ordered_events: [ev("TaskCompleted")], satellite_changes: [] };
    }
    case "ReopenTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["completed"]);
      // → Planned; the op clears completion metadata.
      return { ...base, command_type: command.type, is_create: false, resulting_status: "planned", task_field_deltas: { status: "planned" }, ordered_events: [ev("TaskReopened")], satellite_changes: [] };
    }
    case "ArchiveTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["completed"]);
      // Retention archival — the op sets archive_reason='retention' and preserves completion.
      return { ...base, command_type: command.type, is_create: false, resulting_status: "archived", task_field_deltas: { status: "archived" }, ordered_events: [ev("TaskArchived")], satellite_changes: [] };
    }
    case "DropTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["planned", "scheduled", "in_progress", "waiting"]);
      // Cancelled archival — the op sets archive_reason='cancelled' and clears completion.
      return { ...base, command_type: command.type, is_create: false, resulting_status: "archived", task_field_deltas: { status: "archived" }, ordered_events: [ev("TaskDropped")], satellite_changes: [] };
    }
    case "RestoreTask": {
      const s = requireSnapshot(snapshot);
      assertFrom(s.status, ["archived"]);
      // → Planned; the op clears completion/archive/execution metadata (history untouched).
      return { ...base, command_type: command.type, is_create: false, resulting_status: "planned", task_field_deltas: { status: "planned" }, ordered_events: [ev("TaskRestored")], satellite_changes: [] };
    }

    // ── Attribute-only (status never changes) ───────────────────────────────
    case "RenameTask": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.title)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { title: command.title }, ordered_events: [ev("TaskRenamed")], satellite_changes: [] };
    }
    case "EditDescription": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { description: command.description ?? null }, ordered_events: [ev("TaskDescriptionEdited")], satellite_changes: [] };
    }
    case "ChangePriority": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (command.priority === "critical" && !nonEmpty(command.critical_reason)) throw new TaskError("InvalidCommand");
      return {
        ...base, command_type: command.type, is_create: false, resulting_status: "unchanged",
        task_field_deltas: { priority: command.priority, critical_reason: command.priority === "critical" ? command.critical_reason ?? null : null },
        ordered_events: [ev("TaskPriorityChanged", { from_priority: s.priority, to_priority: command.priority })],
        satellite_changes: [],
      };
    }
    case "ChangeDueDate": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { due_date: command.due_date ?? null }, ordered_events: [ev("TaskDueDateChanged")], satellite_changes: [] };
    }
    case "ChangeEstimate": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (command.estimated_minutes != null && !(Number.isInteger(command.estimated_minutes) && command.estimated_minutes > 0)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { estimated_minutes: command.estimated_minutes ?? null }, ordered_events: [ev("TaskEstimateChanged")], satellite_changes: [] };
    }
    case "ChangeOwner": {
      const s = requireSnapshot(snapshot);
      // Reassignment applies to ACTIVE work only — never to inbox (assign via
      // triage), completed, or archived tasks. This is the sole caller's scope and
      // a defense-in-depth guard: a crafted request cannot re-own a completed task
      // (which would shift its "completed today"/history attribution).
      assertFrom(s.status, ["planned", "scheduled", "in_progress", "waiting"]);
      if (!nonEmpty(command.owner_user_id)) throw new TaskError("MissingOwner");
      // Responsibility model (Slice B): owner is the single source of truth for
      // "assigned to". When an assignee is already set (e.g. an in-progress task
      // that was Started), align it to the new owner so the personal views
      // (owner OR assignee) never diverge — the task moves wholesale to the new
      // admin and leaves the previous admin's active views. When assignee is null
      // it stays null until the normal StartTask flow sets it. This emits only
      // TaskOwnerChanged (the op contract for ChangeOwner) — the accepted v1
      // history tradeoff; the op applies both fields from the deltas generically.
      const deltas: TaskFieldDeltas = { owner_user_id: command.owner_user_id };
      if (nonEmpty(s.assignee_id)) deltas.assignee_id = command.owner_user_id;
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: deltas, ordered_events: [ev("TaskOwnerChanged")], satellite_changes: [] };
    }
    case "AssignTask": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.assignee_id)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { assignee_id: command.assignee_id }, ordered_events: [ev("TaskAssigned")], satellite_changes: [] };
    }
    case "UnassignTask": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (s.status === "in_progress") throw new TaskError("MissingAssignee"); // an in-progress task must keep an assignee
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: { assignee_id: null }, ordered_events: [ev("TaskUnassigned")], satellite_changes: [] };
    }

    // ── Labels (status unchanged) ───────────────────────────────────────────
    case "AddLabel": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.label_id)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: {}, satellite_changes: [{ op: "label_add", label_id: command.label_id }], ordered_events: [ev("TaskLabeled")] };
    }
    case "RemoveLabel": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.label_id)) throw new TaskError("InvalidCommand");
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: {}, satellite_changes: [{ op: "label_remove", label_id: command.label_id }], ordered_events: [ev("TaskUnlabeled")] };
    }

    // ── Dependencies ────────────────────────────────────────────────────────
    case "AddDependency": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.prerequisite_id)) throw new TaskError("InvalidCommand");
      if (command.prerequisite_id === s.id) throw new TaskError("DependencyCycle");
      const isHard = command.kind === "hard";
      const actionable = ACTIONABLE.includes(s.status);
      if (isHard && actionable) {
        // Unmet hard edge on an actionable dependent → auto-block.
        const resume_target = resumeTargetFor(s.status);
        return {
          ...base, command_type: command.type, is_create: false, resulting_status: "waiting",
          task_field_deltas: { status: "waiting", resume_target },
          satellite_changes: [
            { op: "dependency_add", prerequisite_id: command.prerequisite_id, kind: "hard" },
            { op: "blocker_add", blocker_class: "dependency", blocker_key: `dependency:${command.prerequisite_id}`, reference_task_id: command.prerequisite_id },
          ],
          ordered_events: [ev("DependencyAdded"), ev("TaskBlocked")],
        };
      }
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: {}, satellite_changes: [{ op: "dependency_add", prerequisite_id: command.prerequisite_id, kind: command.kind }], ordered_events: [ev("DependencyAdded")] };
    }
    case "RemoveDependency": {
      const s = requireSnapshot(snapshot);
      assertNotArchived(s.status);
      if (!nonEmpty(command.prerequisite_id)) throw new TaskError("InvalidCommand");
      // No auto-unblock in C1 (reactor concern) — status unchanged.
      return { ...base, command_type: command.type, is_create: false, resulting_status: "unchanged", task_field_deltas: {}, satellite_changes: [{ op: "dependency_remove", prerequisite_id: command.prerequisite_id, kind: command.kind, removal_reason: command.removal_reason ?? null }], ordered_events: [ev("DependencyRemoved")] };
    }

    default: {
      // Exhaustiveness guard — an unknown command type is illegal.
      const _never: never = command;
      void _never;
      throw new TaskError("InvalidCommand");
    }
  }
}
