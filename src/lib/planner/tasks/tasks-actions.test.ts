import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));

import { captureTaskAction, triageTaskAction, triageAndScheduleTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";

const KEY = "11111111-1111-1111-1111-111111111111";
const OK = { ok: true, outcome: "applied", taskId: "task-1", aggregateVersion: 1 } as const;
const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null };
const REVALIDATE = ["/admin/planner/inbox", "/admin/planner"];
const lastCall = () => vi.mocked(runTaskCommand).mock.calls[0];

beforeEach(() => {
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  vi.mocked(runTaskCommand).mockReset();
  vi.mocked(runTaskCommand).mockResolvedValue({ ...OK });
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
  it("defaults owner to the current admin (one-click self-triage)", async () => {
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY });
    const [input] = lastCall();
    expect(input.command).toEqual({ type: "TriageTask", owner_user_id: "admin-1" });
    expect(input.task_id).toBe("t1");
    expect(input.expected_aggregate_version).toBe(1);
    expect(input.idempotency_key).toBe(KEY);
  });
  it("uses an explicit ownerUserId when provided (extensible to choose an owner)", async () => {
    await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 2, idempotencyKey: KEY, ownerUserId: "someone-else" });
    expect(lastCall()[0].command).toEqual({ type: "TriageTask", owner_user_id: "someone-else" });
  });
  it("returns NotAuthenticated (without calling the op) when no admin and no owner", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    const res = await triageTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY });
    expect(res).toMatchObject({ ok: false, code: "NotAuthenticated" });
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
});

describe("triageAndScheduleTaskAction", () => {
  it("builds the atomic Inbox→Scheduled command with owner default + unassigned policy", async () => {
    await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10" });
    const [input, opts] = lastCall();
    expect(input.command).toEqual({ type: "TriageAndScheduleTask", owner_user_id: "admin-1", scheduled_date: "2026-08-10", assignee_id: null });
    expect(opts).toEqual({ revalidate: REVALIDATE });
  });
  it("uses an explicit assignee and owner when supplied", async () => {
    await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10", ownerUserId: "o2", assigneeId: "a2" });
    expect(lastCall()[0].command).toEqual({ type: "TriageAndScheduleTask", owner_user_id: "o2", scheduled_date: "2026-08-10", assignee_id: "a2" });
  });
  it("returns NotAuthenticated when no admin and no owner", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    expect(await triageAndScheduleTaskAction({ taskId: "t1", expectedAggregateVersion: 1, idempotencyKey: KEY, scheduledDate: "2026-08-10" })).toMatchObject({ ok: false, code: "NotAuthenticated" });
  });
});
