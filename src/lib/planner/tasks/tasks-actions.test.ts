import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
vi.mock("@/lib/planner/tasks/read-adapters", () => ({ getActiveBlockersFor: vi.fn() }));
vi.mock("@/lib/planner/team", () => ({ listAdminTeam: vi.fn() }));
// Pin "today" (agency) deterministically; keep the real schedule-date validation.
vi.mock("@/lib/planner/tasks/schedule-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planner/tasks/schedule-date")>();
  return { ...actual, agencyToday: () => "2026-08-04" };
});

import {
  captureTaskAction, triageTaskAction, triageAndScheduleTaskAction,
  startTaskAction, completeTaskAction, scheduleTaskAction, rescheduleTaskAction,
  unscheduleTaskAction, deferTaskAction, blockTaskAction, unblockTaskAction, dropTaskAction,
  reassignTaskAction,
} from "@/app/(admin)/admin/planner/tasks/actions";
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { getActiveBlockersFor } from "@/lib/planner/tasks/read-adapters";
import { listAdminTeam } from "@/lib/planner/team";

const KEY = "11111111-1111-1111-1111-111111111111";
const OK = { ok: true, outcome: "applied", taskId: "task-1", aggregateVersion: 1 } as const;
const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null, workspace_id: "ws1" };
const REVALIDATE = ["/admin/planner/inbox", "/admin/planner"];
const lastCall = () => vi.mocked(runTaskCommand).mock.calls[0];

const MY_REVALIDATE = ["/admin/planner/tasks", "/admin/planner"];
const target = { taskId: "t9", expectedAggregateVersion: 4, idempotencyKey: KEY };
const cmd = () => lastCall()[0].command;

beforeEach(() => {
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  vi.mocked(runTaskCommand).mockReset();
  vi.mocked(runTaskCommand).mockResolvedValue({ ...OK });
  vi.mocked(getActiveBlockersFor).mockReset();
  vi.mocked(getActiveBlockersFor).mockResolvedValue([]);
  // Workspace admins for assignment validation (Eloff = self, Ashwin = peer).
  vi.mocked(listAdminTeam).mockReset();
  vi.mocked(listAdminTeam).mockResolvedValue([{ id: "admin-1", fullName: "Eloff" }, { id: "ashwin", fullName: "Ashwin" }] as never);
});

describe("captureTaskAction", () => {
  it("builds CaptureTask, passes idempotency key, revalidates inbox+overview", async () => {
    const res = await captureTaskAction({ title: "Alpha", idempotencyKey: KEY });
    expect(res).toEqual(OK);
    const [input, opts] = lastCall();
    expect(input).toEqual({ command: { type: "CaptureTask", title: "Alpha" }, idempotency_key: KEY });
    expect(opts).toEqual({ revalidate: REVALIDATE });
    expect(getCurrentProfile).not.toHaveBeenCalled(); // create needs no owner
  });
  it("includes priority when supplied", async () => {
    await captureTaskAction({ title: "A", idempotencyKey: KEY, priority: "high" });
    expect(lastCall()[0].command).toEqual({ type: "CaptureTask", title: "A", priority: "high" });
  });
  it("passes through a failure result unchanged", async () => {
    vi.mocked(runTaskCommand).mockResolvedValue({ ok: false, code: "VersionConflict", error: "changed" });
    expect(await captureTaskAction({ title: "A", idempotencyKey: KEY })).toEqual({ ok: false, code: "VersionConflict", error: "changed" });
  });
});

describe("triageTaskAction", () => {
  it("owner is ALWAYS the authenticated admin (browser cannot choose an owner)", async () => {
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY });
    const [input] = lastCall();
    expect(input.command).toEqual({ type: "TriageTask", owner_user_id: "admin-1" });
    expect(input.task_id).toBe("t1");
    expect(input.expected_aggregate_version).toBe(1);
    expect(input.idempotency_key).toBe(KEY);
  });
  it("IGNORES a caller-supplied ownerUserId spoof field (uses the session admin)", async () => {
    // A malicious/extra field cannot select another owner.
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 2, idempotencyKey: KEY, ownerUserId: "attacker-or-client-uuid" } as never);
    expect(lastCall()[0].command).toEqual({ type: "TriageTask", owner_user_id: "admin-1" });
  });
  it("returns NotAuthenticated (without calling the op) when there is no admin session", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    const res = await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY });
    expect(res).toMatchObject({ ok: false, code: "NotAuthenticated" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
});

describe("triageAndScheduleTaskAction", () => {
  it("owner = session admin, assignee ALWAYS null (no browser-selected assignment)", async () => {
    await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10" });
    const [input, opts] = lastCall();
    expect(input.command).toEqual({ type: "TriageAndScheduleTask", owner_user_id: "admin-1", scheduled_date: "2026-08-10", assignee_id: null });
    expect(opts).toEqual({ revalidate: REVALIDATE });
  });
  it("IGNORES caller-supplied ownerUserId/assigneeId spoof fields", async () => {
    await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10", ownerUserId: "attacker", assigneeId: "client-uuid" } as never);
    expect(lastCall()[0].command).toEqual({ type: "TriageAndScheduleTask", owner_user_id: "admin-1", scheduled_date: "2026-08-10", assignee_id: null });
  });
  it("rejects a malformed scheduledDate before dispatch (InvalidCommand, op not called)", async () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-8-1", "08/10/2026", "", "notadate"]) {
      vi.mocked(runTaskCommand).mockClear();
      const res = await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: bad });
      expect(res).toMatchObject({ ok: false, code: "InvalidCommand" });
      expect(runTaskCommand).not.toHaveBeenCalled();
    }
  });
  it("accepts today and future agency dates", async () => {
    for (const good of ["2026-08-04" /* today */, "2026-08-05", "2026-12-31"]) {
      vi.mocked(runTaskCommand).mockClear();
      const res = await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: good });
      expect(res).toEqual(OK);
      expect(lastCall()[0].command).toMatchObject({ scheduled_date: good });
    }
  });
  it("rejects a validly-formatted PAST date server-side (InvalidCommand, op not called)", async () => {
    for (const past of ["2026-08-03", "2026-01-01", "2000-12-31"]) {
      vi.mocked(runTaskCommand).mockClear();
      const res = await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: past });
      expect(res).toMatchObject({ ok: false, code: "InvalidCommand" });
      expect(runTaskCommand).not.toHaveBeenCalled(); // crafted request cannot bypass the today-or-future rule
    }
  });
  it("returns NotAuthenticated when there is no admin session", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    expect(await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10" })).toMatchObject({ ok: false, code: "NotAuthenticated" });
  });
});

describe("task assignment — Slice B (Assign to / reassign)", () => {
  it("triage with a valid workspace-admin assignedToId sets that owner", async () => {
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, assignedToId: "ashwin" });
    expect(lastCall()[0].command).toEqual({ type: "TriageTask", owner_user_id: "ashwin" });
  });
  it("triage defaults the owner to the acting admin ('Me') without a team lookup", async () => {
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY });
    expect(lastCall()[0].command).toEqual({ type: "TriageTask", owner_user_id: "admin-1" });
    expect(listAdminTeam).not.toHaveBeenCalled();
  });
  it("triage REJECTS an assignedToId that is NOT a current-workspace admin (no dispatch)", async () => {
    const res = await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, assignedToId: "outsider-or-client" });
    expect(res).toMatchObject({ ok: false, code: "NotAuthorized" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("triage-and-schedule accepts a validated owner; assignee stays null", async () => {
    await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10", assignedToId: "ashwin" });
    expect(lastCall()[0].command).toEqual({ type: "TriageAndScheduleTask", owner_user_id: "ashwin", scheduled_date: "2026-08-10", assignee_id: null });
  });
  it("triage-and-schedule REJECTS a non-workspace assignedToId (no dispatch)", async () => {
    const res = await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10", assignedToId: "attacker" });
    expect(res).toMatchObject({ ok: false, code: "NotAuthorized" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("reassignTaskAction → ChangeOwner with the validated owner + My Tasks revalidate", async () => {
    const res = await reassignTaskAction({ ...target, assignedToId: "ashwin" });
    expect(res).toEqual(OK);
    const [input, opts] = lastCall();
    expect(input.command).toEqual({ type: "ChangeOwner", owner_user_id: "ashwin" });
    expect(input.task_id).toBe("t9");
    expect(input.expected_aggregate_version).toBe(4);
    expect(input.idempotency_key).toBe(KEY);
    expect(opts).toEqual({ revalidate: MY_REVALIDATE });
  });
  it("reassign to me (self id) is allowed without a team lookup", async () => {
    await reassignTaskAction({ ...target, assignedToId: "admin-1" });
    expect(cmd()).toEqual({ type: "ChangeOwner", owner_user_id: "admin-1" });
    expect(listAdminTeam).not.toHaveBeenCalled();
  });
  it("reassign REJECTS an arbitrary / cross-workspace profile id (no dispatch)", async () => {
    const res = await reassignTaskAction({ ...target, assignedToId: "attacker-uuid" });
    expect(res).toMatchObject({ ok: false, code: "NotAuthorized" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("reassign REJECTS a non-admin session (no dispatch)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    const res = await reassignTaskAction({ ...target, assignedToId: "ashwin" });
    expect(res).toMatchObject({ ok: false, code: "NotAuthorized" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("reassign returns NotAuthenticated without a session", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    expect(await reassignTaskAction({ ...target, assignedToId: "ashwin" })).toMatchObject({ ok: false, code: "NotAuthenticated" });
  });
});

describe("My Tasks lifecycle actions", () => {
  it("startTaskAction: StartTask with assignee = session admin (server-derived), correct target + revalidate", async () => {
    const res = await startTaskAction(target);
    expect(res).toEqual(OK);
    const [input, opts] = lastCall();
    expect(input.command).toEqual({ type: "StartTask", assignee_id: "admin-1" });
    expect(input.task_id).toBe("t9");
    expect(input.expected_aggregate_version).toBe(4);
    expect(input.idempotency_key).toBe(KEY);
    expect(opts).toEqual({ revalidate: MY_REVALIDATE });
  });
  it("startTaskAction: NotAuthenticated without a session (op not called)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    expect(await startTaskAction(target)).toMatchObject({ ok: false, code: "NotAuthenticated" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("startTaskAction: IGNORES a caller-supplied assignee spoof (uses the session admin)", async () => {
    await startTaskAction({ ...target, assigneeId: "attacker" } as never);
    expect(cmd()).toEqual({ type: "StartTask", assignee_id: "admin-1" });
  });
  it("completeTaskAction → CompleteTask", async () => {
    await completeTaskAction(target);
    expect(cmd()).toEqual({ type: "CompleteTask" });
  });
  it("unscheduleTaskAction → UnscheduleTask; deferTaskAction → DeferTask(to=planned); dropTaskAction → DropTask", async () => {
    await unscheduleTaskAction(target); expect(cmd()).toEqual({ type: "UnscheduleTask" });
    vi.mocked(runTaskCommand).mockClear();
    await deferTaskAction(target); expect(cmd()).toEqual({ type: "DeferTask", to: "planned" });
    vi.mocked(runTaskCommand).mockClear();
    await dropTaskAction(target); expect(cmd()).toEqual({ type: "DropTask" });
  });
  it("scheduleTaskAction: accepts today/future, rejects past/malformed BEFORE dispatch", async () => {
    await scheduleTaskAction({ ...target, scheduledDate: "2026-08-10" });
    expect(cmd()).toEqual({ type: "ScheduleTask", scheduled_date: "2026-08-10" });
    for (const bad of ["2026-08-03", "2026-13-01", "nope", ""]) {
      vi.mocked(runTaskCommand).mockClear();
      expect(await scheduleTaskAction({ ...target, scheduledDate: bad })).toMatchObject({ ok: false, code: "InvalidCommand" });
      expect(runTaskCommand).not.toHaveBeenCalled();
    }
  });
  it("rescheduleTaskAction: RescheduleTask on a valid future date; rejects past", async () => {
    await rescheduleTaskAction({ ...target, scheduledDate: "2026-12-31" });
    expect(cmd()).toEqual({ type: "RescheduleTask", scheduled_date: "2026-12-31" });
    vi.mocked(runTaskCommand).mockClear();
    expect(await rescheduleTaskAction({ ...target, scheduledDate: "2000-01-01" })).toMatchObject({ ok: false, code: "InvalidCommand" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("blockTaskAction: BlockTask with class + derived manual key + trimmed reason; rejects an invalid class", async () => {
    await blockTaskAction({ ...target, blockerClass: "approval", reason: "  waiting on copy  " });
    expect(cmd()).toEqual({ type: "BlockTask", blocker: { blocker_class: "approval", blocker_key: `manual:${KEY}`, reason: "waiting on copy" } });
    vi.mocked(runTaskCommand).mockClear();
    await blockTaskAction({ ...target, blockerClass: "person", reason: "   " });
    expect(cmd()).toEqual({ type: "BlockTask", blocker: { blocker_class: "person", blocker_key: `manual:${KEY}`, reason: null } });
    vi.mocked(runTaskCommand).mockClear();
    expect(await blockTaskAction({ ...target, blockerClass: "bogus" as never })).toMatchObject({ ok: false, code: "InvalidCommand" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("unblockTaskAction: resolves the task's active blocker keys via one batched read", async () => {
    vi.mocked(getActiveBlockersFor).mockResolvedValue([{ blocker_key: "manual:a" }, { blocker_key: "person:x" }] as never);
    await unblockTaskAction(target);
    expect(getActiveBlockersFor).toHaveBeenCalledWith(["t9"]);
    expect(cmd()).toEqual({ type: "UnblockTask", resolve_blocker_keys: ["manual:a", "person:x"] });
  });
  it("unblockTaskAction: still unblocks (empty resolve list) if the blocker read fails", async () => {
    vi.mocked(getActiveBlockersFor).mockRejectedValue(new Error("read down"));
    await unblockTaskAction(target);
    expect(cmd()).toEqual({ type: "UnblockTask", resolve_blocker_keys: [] });
  });
  it("all My Tasks actions pass through a failure result unchanged", async () => {
    vi.mocked(runTaskCommand).mockResolvedValue({ ok: false, code: "VersionConflict", error: "changed" });
    expect(await completeTaskAction(target)).toEqual({ ok: false, code: "VersionConflict", error: "changed" });
  });
});
