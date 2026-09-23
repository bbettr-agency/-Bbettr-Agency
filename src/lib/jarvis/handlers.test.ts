import { describe, it, expect, vi, beforeEach } from "vitest";

// The handler is the honesty boundary: it must inspect runTaskCommand's RETURNED
// result (which reports failure as { ok:false }, without throwing). Mock the one
// legal task-write path; the real handler runs.
const runTaskCommand = vi.fn();
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: (...a: unknown[]) => runTaskCommand(...a) }));
// handlers.ts imports the server client for the read-only counts handler; stub it
// so the module imports cleanly in the node test env (it is never called here).
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { getHandler } from "./handlers";
import type { JarvisContext } from "./identity";

const ctx: JarvisContext = { principalId: "p1", workspaceId: "w1", grants: new Set() };

beforeEach(() => vi.clearAllMocks());

describe("portal.propose_internal_task handler — success/failure honesty", () => {
  it("runTaskCommand ok:true → 'verified' with committed taskId as evidence (not 'not_required')", async () => {
    runTaskCommand.mockResolvedValue({ ok: true, outcome: "applied", taskId: "task-123", aggregateVersion: 1 });
    const h = getHandler("portal.propose_internal_task")!;
    const r = await h(ctx, { title: "T" });
    expect(r.verification.state).toBe("verified");
    expect(r.verification.evidence).toMatchObject({ taskId: "task-123", outcome: "applied" });
    expect(r.data).toMatchObject({ taskId: "task-123", outcome: "applied" });
  });

  it("runTaskCommand ok:false → THROWS (never returns a success), message carries the safe code", async () => {
    runTaskCommand.mockResolvedValue({ ok: false, code: "TasksDisabled", error: "Tasks are disabled" });
    const h = getHandler("portal.propose_internal_task")!;
    await expect(h(ctx, { title: "T" })).rejects.toThrow(/TasksDisabled/);
  });

  it("invokes the legal task-write path exactly once with the CaptureTask command (no accidental retry)", async () => {
    runTaskCommand.mockResolvedValue({ ok: false, code: "VersionConflict", error: "x" });
    const h = getHandler("portal.propose_internal_task")!;
    await expect(h(ctx, { title: "Only once" })).rejects.toThrow();
    expect(runTaskCommand).toHaveBeenCalledTimes(1);
    expect(runTaskCommand.mock.calls[0]?.[0]).toMatchObject({ command: { type: "CaptureTask", title: "Only once" } });
  });
});
