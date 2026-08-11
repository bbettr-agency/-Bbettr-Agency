import { describe, it, expect } from "vitest";
import { evaluate, type TaskSnapshot } from "./state-machine";
import { TaskError, type TaskErrorCode } from "./errors";

const snap = (o: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id: "11111111-1111-1111-1111-111111111111",
  status: "planned",
  owner_user_id: "owner-1",
  assignee_id: "assignee-1",
  priority: "normal",
  resume_target: null,
  scheduled_date: null,
  aggregate_version: 3,
  ...o,
});

const expectCode = (fn: () => unknown, code: TaskErrorCode) => {
  try {
    fn();
    throw new Error(`expected TaskError(${code}) but none thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(TaskError);
    expect((e as TaskError).code).toBe(code);
  }
};
const types = (p: { ordered_events: { event_type: string }[] }) => p.ordered_events.map((e) => e.event_type);

describe("state machine — create", () => {
  it("CaptureTask → inbox, one TaskCaptured, is_create", () => {
    const p = evaluate({ type: "CaptureTask", title: "Alpha" });
    expect(p.is_create).toBe(true);
    expect(p.resulting_status).toBe("inbox");
    expect(p.task_field_deltas).toMatchObject({ title: "Alpha", status: "inbox" });
    expect(types(p)).toEqual(["TaskCaptured"]);
  });
  it("CaptureTask empty title → InvalidCommand", () => {
    expectCode(() => evaluate({ type: "CaptureTask", title: "  " }), "InvalidCommand");
  });
  it("RecurringInstanceGenerated → scheduled create with full deltas + event", () => {
    const p = evaluate({
      type: "RecurringInstanceGenerated",
      title: "Send Vision Motors invoice",
      owner_user_id: "eloff",
      assignee_id: null,
      client_id: "client-vm",
      scheduled_date: "2026-08-25",
      due_date: "2026-08-25",
      priority: "normal",
      recurrence_definition_id: "def-1",
      occurrence_slot: "2026-08-25",
    });
    expect(p.is_create).toBe(true);
    expect(p.resulting_status).toBe("scheduled");
    expect(p.task_field_deltas).toMatchObject({
      status: "scheduled",
      title: "Send Vision Motors invoice",
      owner_user_id: "eloff",
      client_id: "client-vm",
      scheduled_date: "2026-08-25",
      due_date: "2026-08-25",
      recurrence_definition_id: "def-1",
      occurrence_slot: "2026-08-25",
    });
    expect(types(p)).toEqual(["RecurringInstanceGenerated"]);
  });
  it("RecurringInstanceGenerated defaults due_date to scheduled_date", () => {
    const p = evaluate({
      type: "RecurringInstanceGenerated",
      title: "T",
      owner_user_id: "o",
      scheduled_date: "2026-09-25",
      recurrence_definition_id: "def-1",
      occurrence_slot: "2026-09-25",
    });
    expect(p.task_field_deltas.due_date).toBe("2026-09-25");
  });
  it("RecurringInstanceGenerated requires owner + slot + definition", () => {
    expectCode(() => evaluate({ type: "RecurringInstanceGenerated", title: "T", owner_user_id: "", scheduled_date: "2026-09-25", recurrence_definition_id: "d", occurrence_slot: "2026-09-25" }), "MissingOwner");
    expectCode(() => evaluate({ type: "RecurringInstanceGenerated", title: "T", owner_user_id: "o", scheduled_date: "2026-09-25", recurrence_definition_id: "", occurrence_slot: "2026-09-25" }), "InvalidCommand");
  });
  it("non-create without snapshot → TaskNotFound", () => {
    expectCode(() => evaluate({ type: "TriageTask", owner_user_id: "o" }), "TaskNotFound");
  });
});

describe("state machine — triage / schedule", () => {
  it("TriageTask inbox+owner → planned", () => {
    const p = evaluate({ type: "TriageTask", owner_user_id: "o" }, snap({ status: "inbox" }));
    expect(p.resulting_status).toBe("planned");
    expect(types(p)).toEqual(["TaskTriaged"]);
  });
  it("TriageTask without owner → MissingOwner", () => {
    expectCode(() => evaluate({ type: "TriageTask", owner_user_id: "" }, snap({ status: "inbox" })), "MissingOwner");
  });
  it("TriageTask from planned → IllegalTransition", () => {
    expectCode(() => evaluate({ type: "TriageTask", owner_user_id: "o" }, snap({ status: "planned" })), "IllegalTransition");
  });
  it("TriageAndScheduleTask inbox → scheduled, two ordered events", () => {
    const p = evaluate({ type: "TriageAndScheduleTask", owner_user_id: "o", scheduled_date: "2026-08-10", assignee_id: null }, snap({ status: "inbox" }));
    expect(p.resulting_status).toBe("scheduled");
    expect(types(p)).toEqual(["TaskTriaged", "TaskScheduled"]);
    expect(p.task_field_deltas.assignee_id).toBeNull(); // explicit unassigned policy
  });
  it("TriageAndScheduleTask missing date → InvalidCommand", () => {
    expectCode(() => evaluate({ type: "TriageAndScheduleTask", owner_user_id: "o", scheduled_date: "" }, snap({ status: "inbox" })), "InvalidCommand");
  });
  it("TriageAndScheduleTask WITHOUT recurrence sets no recurrence deltas (normal flow unchanged)", () => {
    const p = evaluate({ type: "TriageAndScheduleTask", owner_user_id: "o", scheduled_date: "2026-08-10" }, snap({ status: "inbox" }));
    expect(p.task_field_deltas.recurrence_definition_id).toBeUndefined();
    expect(p.task_field_deltas.occurrence_slot).toBeUndefined();
    expect(p.task_field_deltas.client_id).toBeUndefined();
  });
  it("TriageAndScheduleTask WITH recurrence links the first occurrence (same events/status)", () => {
    const p = evaluate(
      {
        type: "TriageAndScheduleTask",
        owner_user_id: "o",
        scheduled_date: "2026-08-25",
        recurrence: { recurrence_definition_id: "def-1", occurrence_slot: "2026-08-25", client_id: "client-vm" },
      },
      snap({ status: "inbox" })
    );
    expect(p.resulting_status).toBe("scheduled");
    expect(types(p)).toEqual(["TaskTriaged", "TaskScheduled"]); // op contract unchanged
    expect(p.task_field_deltas).toMatchObject({
      recurrence_definition_id: "def-1",
      occurrence_slot: "2026-08-25",
      client_id: "client-vm",
      due_date: "2026-08-25", // defaults to scheduled_date
    });
  });
  it("ScheduleTask planned → scheduled; inbox → IllegalTransition", () => {
    expect(evaluate({ type: "ScheduleTask", scheduled_date: "2026-08-10" }, snap({ status: "planned" })).resulting_status).toBe("scheduled");
    expectCode(() => evaluate({ type: "ScheduleTask", scheduled_date: "2026-08-10" }, snap({ status: "inbox" })), "IllegalTransition");
  });
  it("RescheduleTask keeps status unchanged (no status delta)", () => {
    const p = evaluate({ type: "RescheduleTask", scheduled_date: "2026-08-12" }, snap({ status: "scheduled" }));
    expect(p.resulting_status).toBe("unchanged");
    expect("status" in p.task_field_deltas).toBe(false);
    expect(types(p)).toEqual(["TaskRescheduled"]);
  });
  it("UnscheduleTask scheduled → planned, clears date", () => {
    const p = evaluate({ type: "UnscheduleTask" }, snap({ status: "scheduled" }));
    expect(p.resulting_status).toBe("planned");
    expect(p.task_field_deltas.scheduled_date).toBeNull();
  });
});

describe("state machine — start / block / defer", () => {
  it("StartTask scheduled+assignee → in_progress, single TaskStarted", () => {
    const p = evaluate({ type: "StartTask" }, snap({ status: "scheduled", assignee_id: "a" }));
    expect(p.resulting_status).toBe("in_progress");
    expect(types(p)).toEqual(["TaskStarted"]);
  });
  it("StartTask from planned auto-schedules today", () => {
    const p = evaluate({ type: "StartTask" }, snap({ status: "planned", assignee_id: "a" }), { today: "2026-08-03" });
    expect(p.task_field_deltas.scheduled_date).toBe("2026-08-03");
  });
  it("StartTask without assignee → MissingAssignee", () => {
    expectCode(() => evaluate({ type: "StartTask" }, snap({ status: "scheduled", assignee_id: null })), "MissingAssignee");
  });
  it("StartTask from waiting → IllegalTransition (no direct resume)", () => {
    expectCode(() => evaluate({ type: "StartTask" }, snap({ status: "waiting", assignee_id: "a" })), "IllegalTransition");
  });
  it("BlockTask sets waiting + resume target; from in_progress → scheduled", () => {
    const p = evaluate({ type: "BlockTask", blocker: { blocker_class: "person", blocker_key: "person:x", reference_user_id: "x" } }, snap({ status: "in_progress" }));
    expect(p.resulting_status).toBe("waiting");
    expect(p.task_field_deltas.resume_target).toBe("scheduled");
    expect(p.satellite_changes[0]).toMatchObject({ op: "blocker_add", blocker_key: "person:x" });
  });
  it("BlockTask from planned → resume target planned", () => {
    const p = evaluate({ type: "BlockTask", blocker: { blocker_class: "approval", blocker_key: "approval:copy" } }, snap({ status: "planned" }));
    expect(p.task_field_deltas.resume_target).toBe("planned");
  });
  it("DeferTask in_progress → scheduled; from scheduled → IllegalTransition", () => {
    expect(evaluate({ type: "DeferTask", to: "scheduled" }, snap({ status: "in_progress" })).resulting_status).toBe("scheduled");
    expectCode(() => evaluate({ type: "DeferTask", to: "planned" }, snap({ status: "scheduled" })), "IllegalTransition");
  });
});

describe("state machine — unblock / complete", () => {
  it("UnblockTask → resume target with resolves", () => {
    const p = evaluate({ type: "UnblockTask", resolve_blocker_keys: ["person:x"] }, snap({ status: "waiting", resume_target: "scheduled" }));
    expect(p.resulting_status).toBe("scheduled");
    expect(p.satellite_changes).toEqual([{ op: "blocker_resolve", blocker_key: "person:x" }]);
  });
  it("UnblockTask without stored resume target → InvalidCommand", () => {
    expectCode(() => evaluate({ type: "UnblockTask" }, snap({ status: "waiting", resume_target: null })), "InvalidCommand");
  });
  it("CompleteTask actionable → single TaskCompleted", () => {
    const p = evaluate({ type: "CompleteTask" }, snap({ status: "in_progress" }));
    expect(types(p)).toEqual(["TaskCompleted"]);
  });
  it("CompleteTask from waiting → TaskUnblocked then TaskCompleted (ordered)", () => {
    const p = evaluate({ type: "CompleteTask", resolve_blocker_keys: ["a"] }, snap({ status: "waiting", resume_target: "scheduled" }));
    expect(types(p)).toEqual(["TaskUnblocked", "TaskCompleted"]);
    expect(p.resulting_status).toBe("completed");
  });
  it("CompleteTask from inbox → IllegalTransition", () => {
    expectCode(() => evaluate({ type: "CompleteTask" }, snap({ status: "inbox" })), "IllegalTransition");
  });
});

describe("state machine — reopen / archive / drop / restore", () => {
  it("ReopenTask completed → planned; from planned → IllegalTransition", () => {
    expect(evaluate({ type: "ReopenTask" }, snap({ status: "completed" })).resulting_status).toBe("planned");
    expectCode(() => evaluate({ type: "ReopenTask" }, snap({ status: "planned" })), "IllegalTransition");
  });
  it("ArchiveTask only from completed", () => {
    expect(evaluate({ type: "ArchiveTask" }, snap({ status: "completed" })).resulting_status).toBe("archived");
    expectCode(() => evaluate({ type: "ArchiveTask" }, snap({ status: "in_progress" })), "IllegalTransition");
  });
  it("DropTask from active → archived; from completed → IllegalTransition", () => {
    expect(evaluate({ type: "DropTask" }, snap({ status: "waiting", resume_target: "scheduled" })).resulting_status).toBe("archived");
    expectCode(() => evaluate({ type: "DropTask" }, snap({ status: "completed" })), "IllegalTransition");
  });
  it("RestoreTask from archived → planned; else IllegalTransition", () => {
    expect(evaluate({ type: "RestoreTask" }, snap({ status: "archived" })).resulting_status).toBe("planned");
    expectCode(() => evaluate({ type: "RestoreTask" }, snap({ status: "planned" })), "IllegalTransition");
  });
});

describe("state machine — attribute-only (status never changes)", () => {
  const attribute = [
    { c: { type: "RenameTask", title: "New" }, evt: "TaskRenamed" },
    { c: { type: "EditDescription", description: "d" }, evt: "TaskDescriptionEdited" },
    { c: { type: "ChangeDueDate", due_date: "2026-09-01" }, evt: "TaskDueDateChanged" },
    { c: { type: "ChangeEstimate", estimated_minutes: 45 }, evt: "TaskEstimateChanged" },
    { c: { type: "ChangeOwner", owner_user_id: "o2" }, evt: "TaskOwnerChanged" },
    { c: { type: "AssignTask", assignee_id: "a2" }, evt: "TaskAssigned" },
  ] as const;
  for (const { c, evt } of attribute) {
    it(`${c.type} → unchanged + ${evt}`, () => {
      const p = evaluate(c, snap({ status: "scheduled" }));
      expect(p.resulting_status).toBe("unchanged");
      expect("status" in p.task_field_deltas).toBe(false);
      expect(types(p)).toEqual([evt]);
    });
  }
  it("attribute-only on archived → IllegalTransition", () => {
    expectCode(() => evaluate({ type: "RenameTask", title: "x" }, snap({ status: "archived" })), "IllegalTransition");
  });
  it("ChangePriority critical without reason → InvalidCommand; with reason ok", () => {
    expectCode(() => evaluate({ type: "ChangePriority", priority: "critical" }, snap()), "InvalidCommand");
    const p = evaluate({ type: "ChangePriority", priority: "critical", critical_reason: "deadline" }, snap({ priority: "normal" }));
    expect(p.task_field_deltas).toMatchObject({ priority: "critical", critical_reason: "deadline" });
  });
  it("ChangePriority leaving critical clears the reason", () => {
    const p = evaluate({ type: "ChangePriority", priority: "high" }, snap({ priority: "critical" }));
    expect(p.task_field_deltas.critical_reason).toBeNull();
  });
  it("UnassignTask from in_progress → MissingAssignee; else clears assignee", () => {
    expectCode(() => evaluate({ type: "UnassignTask" }, snap({ status: "in_progress" })), "MissingAssignee");
    expect(evaluate({ type: "UnassignTask" }, snap({ status: "planned" })).task_field_deltas.assignee_id).toBeNull();
  });
  it("ChangeOwner ALIGNS assignee to the new owner when assignee is set (no personal-view divergence)", () => {
    const p = evaluate({ type: "ChangeOwner", owner_user_id: "ashwin" }, snap({ status: "in_progress", owner_user_id: "eloff", assignee_id: "eloff" }));
    expect(p.task_field_deltas.owner_user_id).toBe("ashwin");
    expect(p.task_field_deltas.assignee_id).toBe("ashwin"); // aligned → moves wholesale to Ashwin
    expect(p.resulting_status).toBe("unchanged");
    expect(types(p)).toEqual(["TaskOwnerChanged"]); // single event — the accepted v1 history tradeoff
  });
  it("ChangeOwner leaves assignee NULL when it was null (StartTask sets it later)", () => {
    const p = evaluate({ type: "ChangeOwner", owner_user_id: "ashwin" }, snap({ status: "planned", owner_user_id: "eloff", assignee_id: null }));
    expect(p.task_field_deltas.owner_user_id).toBe("ashwin");
    expect("assignee_id" in p.task_field_deltas).toBe(false);
  });
  it("ChangeOwner requires a non-empty owner", () => {
    expectCode(() => evaluate({ type: "ChangeOwner", owner_user_id: "" }, snap()), "MissingOwner");
  });
  it("ChangeOwner is ACTIVE-only — rejected on completed/inbox/archived (defense-in-depth)", () => {
    for (const status of ["completed", "inbox", "archived"] as const) {
      expectCode(() => evaluate({ type: "ChangeOwner", owner_user_id: "ashwin" }, snap({ status })), "IllegalTransition");
    }
    // still legal across the active set
    for (const status of ["planned", "scheduled", "in_progress", "waiting"] as const) {
      expect(evaluate({ type: "ChangeOwner", owner_user_id: "ashwin" }, snap({ status, assignee_id: null })).task_field_deltas.owner_user_id).toBe("ashwin");
    }
  });
  it("ChangeEstimate rejects non-positive", () => {
    expectCode(() => evaluate({ type: "ChangeEstimate", estimated_minutes: 0 }, snap()), "InvalidCommand");
  });
});

describe("state machine — labels & dependencies", () => {
  it("AddLabel → unchanged + label_add satellite", () => {
    const p = evaluate({ type: "AddLabel", label_id: "l1" }, snap({ status: "planned" }));
    expect(p.resulting_status).toBe("unchanged");
    expect(p.satellite_changes).toEqual([{ op: "label_add", label_id: "l1" }]);
    expect(types(p)).toEqual(["TaskLabeled"]);
  });
  it("RemoveLabel → label_remove", () => {
    expect(evaluate({ type: "RemoveLabel", label_id: "l1" }, snap()).satellite_changes).toEqual([{ op: "label_remove", label_id: "l1" }]);
  });
  it("AddDependency hard on actionable → auto-block (waiting, 2 events, dep + blocker)", () => {
    const p = evaluate({ type: "AddDependency", prerequisite_id: "22222222-2222-2222-2222-222222222222", kind: "hard" }, snap({ status: "scheduled" }));
    expect(p.resulting_status).toBe("waiting");
    expect(types(p)).toEqual(["DependencyAdded", "TaskBlocked"]);
    expect(p.satellite_changes.map((s) => s.op)).toEqual(["dependency_add", "blocker_add"]);
  });
  it("AddDependency info edge → unchanged, single event", () => {
    const p = evaluate({ type: "AddDependency", prerequisite_id: "22222222-2222-2222-2222-222222222222", kind: "info" }, snap({ status: "scheduled" }));
    expect(p.resulting_status).toBe("unchanged");
    expect(types(p)).toEqual(["DependencyAdded"]);
  });
  it("AddDependency on self → DependencyCycle", () => {
    expectCode(() => evaluate({ type: "AddDependency", prerequisite_id: snap().id, kind: "hard" }, snap({ status: "scheduled" })), "DependencyCycle");
  });
  it("RemoveDependency → unchanged + dependency_remove (no auto-unblock in C1)", () => {
    const p = evaluate({ type: "RemoveDependency", prerequisite_id: "22222222-2222-2222-2222-222222222222", kind: "hard" }, snap({ status: "waiting", resume_target: "scheduled" }));
    expect(p.resulting_status).toBe("unchanged");
    expect(p.satellite_changes[0]).toMatchObject({ op: "dependency_remove", kind: "hard" });
  });
});
