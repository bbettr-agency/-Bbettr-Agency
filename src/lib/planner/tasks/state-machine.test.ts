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
