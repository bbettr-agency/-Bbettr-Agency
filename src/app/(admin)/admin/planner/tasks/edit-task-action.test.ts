import { describe, it, expect, beforeEach, vi } from "vitest";

// editTaskAction must go through the EXISTING commands (never a raw DB write),
// dispatch ONLY changed fields, thread aggregate_version between them, and emit
// nothing on a no-op.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
// Keep other imports in actions.ts (recurrence/team) from touching real modules.
vi.mock("@/lib/planner/team", () => ({ listAdminTeam: vi.fn() }));
vi.mock("@/lib/planner/recurrence/definitions", () => ({ createRecurringDefinition: vi.fn(), activateRecurringDefinition: vi.fn() }));
vi.mock("@/lib/planner/recurrence/generator", () => ({ generateForDefinitionId: vi.fn() }));

import { editTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";

const KEY = "11111111-1111-1111-1111-111111111111";
const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null, workspace_id: "ws1" };
const base = { taskId: "t9", expectedAggregateVersion: 5, idempotencyKey: KEY };
const calls = () => vi.mocked(runTaskCommand).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  vi.mocked(runTaskCommand).mockReset();
  // Echo a monotonically advancing aggregate version so threading is observable.
  vi.mocked(runTaskCommand).mockImplementation(async (input) => ({
    ok: true,
    outcome: "applied",
    taskId: input.task_id ?? "t9",
    aggregateVersion: (input.expected_aggregate_version ?? 0) + 1,
  } as never));
});

describe("editTaskAction — authorization", () => {
  it("rejects a non-admin and dispatches nothing", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    const res = await editTaskAction({ ...base, title: "New" });
    expect(res.ok).toBe(false);
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null as never);
    expect((await editTaskAction({ ...base, title: "New" })).ok).toBe(false);
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
});

describe("editTaskAction — change detection", () => {
  it("no fields → no commands, no events (no-op success)", async () => {
    const res = await editTaskAction({ ...base });
    expect(res.ok).toBe(true);
    expect(runTaskCommand).not.toHaveBeenCalled();
  });

  it("title only → a single RenameTask with a suffixed key", async () => {
    const res = await editTaskAction({ ...base, title: "  Update Vision Motors homepage  " });
    expect(res.ok).toBe(true);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].command).toEqual({ type: "RenameTask", title: "Update Vision Motors homepage" });
    expect(calls()[0].idempotency_key).toBe(`${KEY}:title`);
    expect(calls()[0].expected_aggregate_version).toBe(5);
  });

  it("empty title → InvalidCommand, nothing dispatched", async () => {
    const res = await editTaskAction({ ...base, title: "   " });
    expect(res.ok).toBe(false);
    expect(runTaskCommand).not.toHaveBeenCalled();
  });

  it("description cleared → EditDescription(null)", async () => {
    await editTaskAction({ ...base, description: "   " });
    expect(calls()[0].command).toEqual({ type: "EditDescription", description: null });
  });
});

describe("editTaskAction — version threading across multiple fields", () => {
  it("dispatches RenameTask → EditDescription → ChangePriority, threading versions", async () => {
    const res = await editTaskAction({ ...base, title: "T2", description: "D2", priority: "high" });
    expect(res.ok).toBe(true);
    const c = calls();
    expect(c.map((x) => x.command.type)).toEqual(["RenameTask", "EditDescription", "ChangePriority"]);
    // Version threaded: 5 → 6 → 7 across the three commands.
    expect(c.map((x) => x.expected_aggregate_version)).toEqual([5, 6, 7]);
    expect(c.map((x) => x.idempotency_key)).toEqual([`${KEY}:title`, `${KEY}:desc`, `${KEY}:prio`]);
    if (res.ok) expect(res.aggregateVersion).toBe(8); // last returned version
  });

  it("stops on the first failure and does not dispatch later fields", async () => {
    vi.mocked(runTaskCommand).mockResolvedValueOnce({ ok: false, code: "VersionConflict", error: "changed" } as never);
    const res = await editTaskAction({ ...base, title: "T2", description: "D2" });
    expect(res.ok).toBe(false);
    expect(runTaskCommand).toHaveBeenCalledTimes(1); // description never attempted
  });
});

describe("editTaskAction — priority + critical", () => {
  it("critical without a reason → InvalidCommand, nothing dispatched", async () => {
    const res = await editTaskAction({ ...base, priority: "critical" });
    expect(res.ok).toBe(false);
    expect(runTaskCommand).not.toHaveBeenCalled();
  });
  it("critical with a reason → ChangePriority carries critical_reason", async () => {
    await editTaskAction({ ...base, priority: "critical", criticalReason: "Client deadline" });
    expect(calls()[0].command).toEqual({ type: "ChangePriority", priority: "critical", critical_reason: "Client deadline" });
  });
  it("non-critical priority → critical_reason null", async () => {
    await editTaskAction({ ...base, priority: "low" });
    expect(calls()[0].command).toEqual({ type: "ChangePriority", priority: "low", critical_reason: null });
  });
});
