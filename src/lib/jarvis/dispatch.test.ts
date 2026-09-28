import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the server-only side-effecting collaborators so dispatch composes purely.
const appendJarvisAction = vi.fn(async (_input: unknown) => {});
vi.mock("./audit", () => ({ appendJarvisAction: (x: unknown) => appendJarvisAction(x) }));

// Loose return type so per-test mockResolvedValueOnce can script created/reused/conflict.
const createProposal = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ outcome: "created", id: "prop-1", effectHash: "h" }));
vi.mock("./proposals", () => ({ createProposal: (...a: unknown[]) => createProposal(...a) }));

const handlerCalls: string[] = [];
vi.mock("./handlers", () => ({
  getHandler: (id: string) =>
    async () => {
      handlerCalls.push(id);
      return { data: { ran: id }, verification: { state: "not_required" } };
    },
}));

import { invokeCapability } from "./dispatch";
import type { JarvisContext } from "./identity";

const FOUNDER = new Set(["jarvis.use", "portal.read", "portal.tasks.write", "integrations.read", "jarvis.approve"]);
const ctx = (grants: Set<string> = FOUNDER): JarvisContext => ({ principalId: "p1", workspaceId: "w1", grants });

beforeEach(() => {
  vi.clearAllMocks();
  handlerCalls.length = 0;
});

describe("invokeCapability — deterministic routing + audit", () => {
  it("audits the decision for EVERY invocation (before side effects)", async () => {
    await invokeCapability(ctx(), "jarvis.ping", {});
    expect(appendJarvisAction).toHaveBeenCalled();
    const first = appendJarvisAction.mock.calls[0]?.[0] as { decision: string };
    expect(first.decision).toBe("allow");
  });

  it("unregistered capability → deny, no handler, no proposal", async () => {
    const r = await invokeCapability(ctx(), "execute_sql", { q: "drop" });
    expect(r).toMatchObject({ status: "deny", reason: "unregistered_capability" });
    expect(handlerCalls).toHaveLength(0);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("auto capability WITH grant → allow + handler executes", async () => {
    const r = await invokeCapability(ctx(), "jarvis.ping", {});
    expect(r.status).toBe("allow");
    expect(handlerCalls).toEqual(["jarvis.ping"]);
  });

  it("auto capability WITHOUT grant → deny (default-deny), handler not run", async () => {
    const r = await invokeCapability(ctx(new Set(["jarvis.use"])), "portal.read_task_counts", {});
    expect(r).toMatchObject({ status: "deny", reason: "missing_grant" });
    expect(handlerCalls).toHaveLength(0);
  });

  it("confirm capability + valid args → needs_approval (proposal created, NOT executed)", async () => {
    const r = await invokeCapability(ctx(), "portal.propose_internal_task", { title: "Do it" });
    expect(r).toMatchObject({ status: "needs_approval", proposalId: "prop-1" });
    expect(createProposal).toHaveBeenCalledTimes(1);
    expect(handlerCalls).toHaveLength(0); // confirm never executes on invoke
  });

  it("confirm capability + INVALID args → deny (never proposes)", async () => {
    const r = await invokeCapability(ctx(), "portal.propose_internal_task", {});
    expect(r).toMatchObject({ status: "deny", reason: "invalid_arguments" });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("monitor capability → monitor_only + read-only handler (returns unknown)", async () => {
    const r = await invokeCapability(ctx(), "integrations.read_deployment_state", {});
    expect(r.status).toBe("monitor_only");
    expect(handlerCalls).toEqual(["integrations.read_deployment_state"]);
  });

  it("malformed args for a monitor read → deny before execution", async () => {
    const r = await invokeCapability(ctx(), "integrations.read_deployment_state", { clientId: "not-a-uuid" });
    expect(r).toMatchObject({ status: "deny", reason: "invalid_arguments" });
    expect(handlerCalls).toHaveLength(0);
  });
});

describe("invokeCapability — F1c operation-key idempotency (never an authorization shortcut)", () => {
  const OP_KEY = "turn:11111111-1111-4111-8111-111111111111:action:0";

  it("forwards the trusted operation key to createProposal (CANONICAL args, not raw)", async () => {
    createProposal.mockResolvedValueOnce({ outcome: "created", id: "prop-1", effectHash: "h" });
    const r = await invokeCapability(ctx(), "portal.propose_internal_task", { title: "  Trim me  ", ignored: "x" }, { idempotencyKey: OP_KEY });
    expect(r).toMatchObject({ status: "needs_approval", proposalId: "prop-1" });
    // 5th positional arg is the operation key; the 3rd is F1-canonicalized args (unknown
    // keys stripped by cap.parse → only { title }).
    const call = createProposal.mock.calls[0]!;
    expect(call[4]).toBe(OP_KEY);
    expect(call[1]).toBe("portal.propose_internal_task");
    expect(call[2]).toEqual({ title: "Trim me" });
  });

  it("same key + same effect + existing PENDING reuse → needs_approval (same id, truthful)", async () => {
    createProposal.mockResolvedValueOnce({ outcome: "reused", id: "prop-existing", effectHash: "h", status: "pending" });
    const r = await invokeCapability(ctx(), "portal.propose_internal_task", { title: "Do it" }, { idempotencyKey: OP_KEY });
    expect(r).toEqual({ status: "needs_approval", proposalId: "prop-existing" });
  });

  it("same key + same effect + existing NON-PENDING reuse → error (never a fake pending approval)", async () => {
    for (const status of ["approved", "executed", "rejected", "expired", "failed"] as const) {
      createProposal.mockResolvedValueOnce({ outcome: "reused", id: "p", effectHash: "h", status });
      const r = await invokeCapability(ctx(), "portal.propose_internal_task", { title: "Do it" }, { idempotencyKey: OP_KEY });
      expect(r).toEqual({ status: "error", reason: "idempotency_state" });
    }
  });

  it("same key + DIFFERENT effect → error idempotency_conflict (fail closed)", async () => {
    createProposal.mockResolvedValueOnce({ outcome: "conflict" });
    const r = await invokeCapability(ctx(), "portal.propose_internal_task", { title: "Do it" }, { idempotencyKey: OP_KEY });
    expect(r).toEqual({ status: "error", reason: "idempotency_conflict" });
  });

  it("lost grant → deny BEFORE any get-or-create, even with a matching operation key", async () => {
    const r = await invokeCapability(ctx(new Set(["jarvis.use"])), "portal.propose_internal_task", { title: "Do it" }, { idempotencyKey: OP_KEY });
    expect(r).toMatchObject({ status: "deny" });
    expect(createProposal).not.toHaveBeenCalled(); // idempotency is not authorization
  });
});
