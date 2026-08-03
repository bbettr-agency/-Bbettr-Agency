import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
vi.mock("@/lib/flags", () => ({ isTasksEnabled: vi.fn(() => true) }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./service-role-operations", () => ({ invokeApplyTaskCommand: vi.fn() }));

import { dispatchTaskCommand, type DispatchTaskCommandInput } from "./command-adapter";
import { TaskError, type TaskErrorCode } from "./errors";
import { isTasksEnabled } from "@/lib/flags";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invokeApplyTaskCommand } from "./service-role-operations";

const KEY = "11111111-1111-1111-1111-111111111111";
const ADMIN = {
  id: "admin-1",
  role: "admin" as string,
  full_name: "Eloff" as string | null,
  email: "e@bbettr.com" as string | null,
  client_id: null as string | null,
};

function fakeSupabase(opts: { workspace?: string | null; task?: unknown; wsError?: unknown; taskError?: unknown } = {}) {
  const { workspace = "ws-1", task = null, wsError = null, taskError = null } = opts;
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: task, error: taskError })),
  };
  return {
    rpc: vi.fn(async (name: string) => (name === "current_workspace_id" ? { data: wsError ? null : workspace, error: wsError } : { data: null, error: null })),
    from: vi.fn(() => builder),
  };
}

const setSupabase = (s: unknown) => vi.mocked(createClient).mockResolvedValue(s as never);
const okResult = { outcome: "applied", result_task_id: "task-1", result_aggregate_version: 1 } as const;

async function expectCode(p: Promise<unknown>, code: TaskErrorCode) {
  await expect(p).rejects.toBeInstanceOf(TaskError);
  await p.catch((e) => expect((e as TaskError).code).toBe(code));
}

const capture: DispatchTaskCommandInput = { command: { type: "CaptureTask", title: "Alpha" }, idempotency_key: KEY };

beforeEach(() => {
  vi.mocked(isTasksEnabled).mockReturnValue(true);
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  setSupabase(fakeSupabase());
  vi.mocked(invokeApplyTaskCommand).mockResolvedValue({ ...okResult });
});

describe("command-adapter — refusals", () => {
  it("flag off → TasksDisabled (before any auth/db work)", async () => {
    vi.mocked(isTasksEnabled).mockReturnValue(false);
    await expectCode(dispatchTaskCommand(capture), "TasksDisabled");
    expect(getCurrentProfile).not.toHaveBeenCalled();
  });
  it("empty idempotency key → InvalidCommand", async () => {
    await expectCode(dispatchTaskCommand({ ...capture, idempotency_key: "   " }), "InvalidCommand");
  });
  it("over-long idempotency key → InvalidCommand", async () => {
    await expectCode(dispatchTaskCommand({ ...capture, idempotency_key: "x".repeat(201) }), "InvalidCommand");
  });
  it("no session → NotAuthenticated", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    await expectCode(dispatchTaskCommand(capture), "NotAuthenticated");
  });
  it("non-admin → NotAuthorized", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    await expectCode(dispatchTaskCommand(capture), "NotAuthorized");
  });
  it("null workspace → NoWorkspace", async () => {
    setSupabase(fakeSupabase({ workspace: null }));
    await expectCode(dispatchTaskCommand(capture), "NoWorkspace");
  });
  it("non-create without task_id → InvalidCommand", async () => {
    await expectCode(dispatchTaskCommand({ command: { type: "CompleteTask" }, idempotency_key: KEY, expected_aggregate_version: 1 }), "InvalidCommand");
  });
  it("non-create without expected version → InvalidCommand", async () => {
    setSupabase(fakeSupabase({ task: { id: "task-1", status: "in_progress", owner_user_id: "o", assignee_id: "a", priority: "normal", resume_target: null, scheduled_date: null, aggregate_version: 4 } }));
    await expectCode(dispatchTaskCommand({ command: { type: "CompleteTask" }, task_id: "task-1", idempotency_key: KEY }), "InvalidCommand");
  });
  it("non-create with missing task → TaskNotFound", async () => {
    setSupabase(fakeSupabase({ task: null }));
    await expectCode(dispatchTaskCommand({ command: { type: "CompleteTask" }, task_id: "task-x", expected_aggregate_version: 4, idempotency_key: KEY }), "TaskNotFound");
  });
  it("db error from the op is mapped (BB460 → VersionConflict)", async () => {
    setSupabase(fakeSupabase({ task: { id: "task-1", status: "in_progress", owner_user_id: "o", assignee_id: "a", priority: "normal", resume_target: null, scheduled_date: null, aggregate_version: 4 } }));
    vi.mocked(invokeApplyTaskCommand).mockRejectedValue({ code: "BB460", message: "raw" });
    await expectCode(dispatchTaskCommand({ command: { type: "CompleteTask" }, task_id: "task-1", expected_aggregate_version: 4, idempotency_key: KEY }), "VersionConflict");
  });
});

describe("command-adapter — trusted actor & workspace derivation", () => {
  it("derives actor from the authenticated profile and workspace from the RPC", async () => {
    const res = await dispatchTaskCommand(capture);
    expect(res).toEqual(okResult);
    const envelope = vi.mocked(invokeApplyTaskCommand).mock.calls[0][0];
    expect(envelope.actor).toEqual({ actor_kind: "user", actor_user_id: "admin-1", actor_ref: null, actor_display: "Eloff" });
    expect(envelope.workspace_id).toBe("ws-1");
    expect(envelope.task_id).toBeNull(); // create
    expect(envelope.expected_aggregate_version).toBeNull();
    expect(envelope.command_idempotency_key).toBe(KEY);
    expect(envelope.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.ordered_events.map((e) => e.event_type)).toEqual(["TaskCaptured"]);
  });
  it("caller-supplied actor/workspace/created_by are IGNORED (cannot spoof)", async () => {
    const spoofed = {
      ...capture,
      actor: { actor_kind: "system", actor_user_id: "attacker", actor_display: "Root" },
      workspace_id: "other-ws",
      created_by: "attacker",
      role: "admin",
    } as unknown as DispatchTaskCommandInput;
    await dispatchTaskCommand(spoofed);
    const envelope = vi.mocked(invokeApplyTaskCommand).mock.calls[0][0];
    expect(envelope.actor.actor_user_id).toBe("admin-1"); // from the session, not the caller
    expect(envelope.actor.actor_kind).toBe("user");
    expect(envelope.workspace_id).toBe("ws-1"); // from current_workspace_id(), not the caller
  });
  it("actor_display falls back email → 'Admin' when name is absent", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, full_name: null } as never);
    await dispatchTaskCommand(capture);
    expect(vi.mocked(invokeApplyTaskCommand).mock.calls[0][0].actor.actor_display).toBe("e@bbettr.com");
    vi.mocked(invokeApplyTaskCommand).mockClear();
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, full_name: null, email: null } as never);
    await dispatchTaskCommand(capture);
    expect(vi.mocked(invokeApplyTaskCommand).mock.calls[0][0].actor.actor_display).toBe("Admin");
  });
  it("passes the caller's expected version through for optimistic concurrency", async () => {
    setSupabase(fakeSupabase({ task: { id: "task-1", status: "in_progress", owner_user_id: "o", assignee_id: "a", priority: "normal", resume_target: null, scheduled_date: null, aggregate_version: 9 } }));
    await dispatchTaskCommand({ command: { type: "CompleteTask" }, task_id: "task-1", expected_aggregate_version: 4, idempotency_key: KEY });
    // uses the CALLER's expected version (4), not the freshly-read row version (9)
    expect(vi.mocked(invokeApplyTaskCommand).mock.calls[0][0].expected_aggregate_version).toBe(4);
  });
});
