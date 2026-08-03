import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isTasksEnabled: vi.fn(() => true) }));
vi.mock("./command-adapter", () => ({ dispatchTaskCommand: vi.fn() }));

import { runTaskCommand } from "./run-command";
import { TaskError } from "./errors";
import { isTasksEnabled } from "@/lib/flags";
import { dispatchTaskCommand, type DispatchTaskCommandInput } from "./command-adapter";
import { revalidatePath } from "next/cache";
import type { ApprovedPlannerPath } from "./action-result";

const KEY = "11111111-1111-1111-1111-111111111111";
const input: DispatchTaskCommandInput = { command: { type: "CaptureTask", title: "Alpha" }, idempotency_key: KEY };
const ok = (o: string) => ({ outcome: o, result_task_id: "task-1", result_aggregate_version: 2 });

beforeEach(() => {
  vi.mocked(isTasksEnabled).mockReturnValue(true);
  vi.mocked(dispatchTaskCommand).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("run-command — flag gate", () => {
  it("disabled → safe TasksDisabled result, adapter not called", async () => {
    vi.mocked(isTasksEnabled).mockReturnValue(false);
    const r = await runTaskCommand(input);
    expect(r).toEqual({ ok: false, code: "TasksDisabled", error: expect.any(String) });
    expect(dispatchTaskCommand).not.toHaveBeenCalled();
  });
});

describe("run-command — success outcomes", () => {
  for (const outcome of ["applied", "accepted_noop", "replayed"] as const) {
    it(`${outcome} → success result with id + version`, async () => {
      vi.mocked(dispatchTaskCommand).mockResolvedValue(ok(outcome) as never);
      const r = await runTaskCommand(input);
      expect(r).toEqual({ ok: true, outcome, taskId: "task-1", aggregateVersion: 2 });
    });
  }
});

describe("run-command — error mapping (never leaks raw)", () => {
  const codes = ["NotAuthenticated", "NotAuthorized", "NoWorkspace", "VersionConflict", "IdempotencyConflict", "EventContractViolation", "ArchivedLabel", "TaskNotFound", "CrossWorkspaceReference"] as const;
  for (const code of codes) {
    it(`adapter throws ${code} → failure with that code`, async () => {
      vi.mocked(dispatchTaskCommand).mockRejectedValue(new TaskError(code));
      const r = await runTaskCommand(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    });
  }
  it("unknown SQLSTATE (non-TaskError) → PersistenceError, safe", async () => {
    vi.mocked(dispatchTaskCommand).mockRejectedValue({ code: "BB999", message: "raw sql text: secret=abc" });
    const r = await runTaskCommand(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PersistenceError");
      expect(r.error).not.toContain("secret");
      expect(r.error).not.toContain("sql");
    }
  });
  it("raw Error is not leaked", async () => {
    vi.mocked(dispatchTaskCommand).mockRejectedValue(new Error("connection string postgres://user:pw@host"));
    const r = await runTaskCommand(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("postgres://");
  });
});

describe("run-command — revalidation whitelist", () => {
  it("revalidates approved paths on success only", async () => {
    vi.mocked(dispatchTaskCommand).mockResolvedValue(ok("applied") as never);
    await runTaskCommand(input, { revalidate: ["/admin/planner/inbox", "/admin/planner"] });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/planner/inbox");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/planner");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });
  it("ignores a non-approved path (cannot trigger arbitrary revalidation)", async () => {
    vi.mocked(dispatchTaskCommand).mockResolvedValue(ok("applied") as never);
    await runTaskCommand(input, { revalidate: ["/admin/secret", "/etc/passwd", "/admin/planner/tasks"] as unknown as ApprovedPlannerPath[] });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/planner/tasks");
  });
  it("does not revalidate on failure", async () => {
    vi.mocked(dispatchTaskCommand).mockRejectedValue(new TaskError("VersionConflict"));
    await runTaskCommand(input, { revalidate: ["/admin/planner/inbox"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
