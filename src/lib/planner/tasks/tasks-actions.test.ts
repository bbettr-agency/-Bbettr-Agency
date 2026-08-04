import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
// Pin "today" (agency) deterministically; keep the real schedule-date validation.
vi.mock("@/lib/planner/tasks/schedule-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planner/tasks/schedule-date")>();
  return { ...actual, agencyToday: () => "2026-08-04" };
});

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
