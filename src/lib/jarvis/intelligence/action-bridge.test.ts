import { describe, it, expect, vi } from "vitest";

// The bridge statically imports F1 dispatch (→ audit → supabase). We inject the
// invoke seam, so stub the supabase modules whose import would otherwise load.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin1", role: "admin" }), getCurrentProfile: async () => null }));

import { bridgeProposedIntent, INTELLIGENCE_ACTION_ALLOWLIST } from "./action-bridge";
import { getCapability } from "@/lib/jarvis/capabilities";
import type { InvokeResult } from "@/lib/jarvis/dispatch";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan, ValidatedProposedIntent } from "./types";

const CTX: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use", "portal.read", "portal.tasks.write", "integrations.read"]) };
const AGENCY: ContextPlan = { kind: "agency" };

function intent(capabilityId: string, args: Record<string, unknown> = {}, rationale?: string): ValidatedProposedIntent {
  return { capabilityId, args, rationale };
}

/** An invoke seam that records calls and returns a scripted result. */
function fakeInvoke(result: InvokeResult) {
  const calls: Array<{ capabilityId: string; args: unknown; opts: unknown }> = [];
  const invoke = vi.fn(async (_ctx: JarvisContext, capabilityId: string, args: unknown, opts?: unknown) => {
    calls.push({ capabilityId, args, opts });
    return result;
  });
  return { invoke, calls };
}

describe("action-bridge — allowlist is the gate (model capability_id has zero authority)", () => {
  it("no proposed_intent ⇒ not_requested", async () => {
    const { invoke } = fakeInvoke({ status: "allow", result: {}, verification: { state: "not_required" } as never });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: undefined, plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "not_requested" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a capability that is not on the Intelligence allowlist (even if registered)", async () => {
    const { invoke } = fakeInvoke({ status: "allow", result: {}, verification: { state: "not_required" } as never });
    // jarvis.ping IS in the F1 registry but deliberately NOT allowlisted.
    expect(getCapability("jarvis.ping")).not.toBeNull();
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("jarvis.ping"), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "rejected_by_bridge", reason: "not_allowlisted" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["admin.grant_all", "jarvis.approve", "db.execute_sql", "portal.delete_everything"])(
    "rejects dangerous/arbitrary capability %s before touching F1",
    async (capId) => {
      const { invoke } = fakeInvoke({ status: "allow", result: {}, verification: { state: "not_required" } as never });
      const r = await bridgeProposedIntent({ ctx: CTX, intent: intent(capId), plan: AGENCY }, { invoke });
      expect(r).toEqual({ status: "rejected_by_bridge", reason: "not_allowlisted" });
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it("rejects an allowlisted id that is somehow not in the canonical registry", async () => {
    const { invoke } = fakeInvoke({ status: "allow", result: {}, verification: { state: "not_required" } as never });
    const r = await bridgeProposedIntent(
      { ctx: CTX, intent: intent("portal.read_task_counts"), plan: AGENCY },
      { invoke, getCap: () => null }
    );
    expect(r).toEqual({ status: "rejected_by_bridge", reason: "unregistered_capability" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("the allowlist contains exactly the three intended v1 capabilities (no jarvis.ping)", () => {
    expect([...INTELLIGENCE_ACTION_ALLOWLIST].sort()).toEqual([
      "integrations.read_deployment_state",
      "portal.propose_internal_task",
      "portal.read_task_counts",
    ]);
  });
});

describe("action-bridge — faithful mapping of the trusted F1 result", () => {
  it("read capability (auto/allow) ⇒ read_result", async () => {
    const { invoke, calls } = fakeInvoke({ status: "allow", result: { inbox: 3 }, verification: { state: "not_required" } as never });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts"), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "read_result", capabilityId: "portal.read_task_counts", result: { inbox: 3 } });
    expect(calls).toHaveLength(1);
  });

  it("monitor capability ⇒ monitor_only (unavailable is never a positive claim)", async () => {
    const { invoke } = fakeInvoke({ status: "monitor_only", result: { state: "unknown" }, verification: { state: "unavailable" } as never });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("integrations.read_deployment_state"), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "monitor_only", capabilityId: "integrations.read_deployment_state", result: { state: "unknown" } });
  });

  it("write capability (confirm) ⇒ approval_required with the F1 proposalId, NOT executed", async () => {
    const { invoke, calls } = fakeInvoke({ status: "needs_approval", proposalId: "prop-1" });
    const r = await bridgeProposedIntent(
      { ctx: CTX, intent: intent("portal.propose_internal_task", { title: "Call Fine Art tomorrow" }), plan: AGENCY },
      { invoke }
    );
    expect(r).toEqual({ status: "approval_required", capabilityId: "portal.propose_internal_task", proposalId: "prop-1" });
    // delegated to F1 exactly once; the bridge never approves or executes.
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ title: "Call Fine Art tomorrow" });
  });

  it("policy deny (e.g. invalid arguments / missing grant) ⇒ unauthorized with the reason", async () => {
    const { invoke } = fakeInvoke({ status: "deny", reason: "invalid_arguments" });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.propose_internal_task", {}), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "unauthorized", reason: "invalid_arguments" });
  });

  it("F1 execution error ⇒ failed (never 'done')", async () => {
    const { invoke } = fakeInvoke({ status: "error", reason: "execution_failed" });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts"), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "failed", capabilityId: "portal.read_task_counts", reason: "execution_failed" });
  });

  it("an invoke that throws ⇒ failed, never a success", async () => {
    const invoke = vi.fn(async () => { throw new Error("boom"); });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts"), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "failed", capabilityId: "portal.read_task_counts", reason: "bridge_invocation_failed" });
  });
});

describe("action-bridge — fail-closed arg envelope (Slice-D-local guard, before F1)", () => {
  it("valid EXACT args pass the envelope and reach F1", async () => {
    const { invoke, calls } = fakeInvoke({ status: "needs_approval", proposalId: "p1" });
    const r = await bridgeProposedIntent(
      { ctx: CTX, intent: intent("portal.propose_internal_task", { title: "Call Fine Art" }), plan: AGENCY },
      { invoke }
    );
    expect(r.status).toBe("approval_required");
    expect(calls).toHaveLength(1);
  });

  it.each(["due_date", "when", "assignee", "priority", "__proto__"])(
    "rejects propose_internal_task with an extra key %s BEFORE F1 (no proposal created)",
    async (extra) => {
      const { invoke } = fakeInvoke({ status: "needs_approval", proposalId: "p1" });
      const r = await bridgeProposedIntent(
        { ctx: CTX, intent: intent("portal.propose_internal_task", { title: "Call Fine Art", [extra]: "x" }), plan: AGENCY },
        { invoke }
      );
      expect(r).toEqual({ status: "rejected_by_bridge", reason: `unexpected_arg_key:${extra}` });
      expect(invoke).not.toHaveBeenCalled(); // fail-closed: F1 never touched
    }
  );

  it("read_task_counts must carry NO args — any key is rejected", async () => {
    const { invoke } = fakeInvoke({ status: "allow", result: {}, verification: {} as never });
    const ok = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts", {}), plan: AGENCY }, { invoke });
    expect(ok.status).toBe("read_result");
    const bad = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts", { status: "inbox" }), plan: AGENCY }, { invoke });
    expect(bad).toEqual({ status: "rejected_by_bridge", reason: "unexpected_arg_key:status" });
  });

  it("read_deployment_state allows only optional clientId; extra keys rejected", async () => {
    const { invoke } = fakeInvoke({ status: "monitor_only", result: { state: "unknown" }, verification: {} as never });
    const ok = await bridgeProposedIntent({ ctx: CTX, intent: intent("integrations.read_deployment_state", {}), plan: AGENCY }, { invoke });
    expect(ok.status).toBe("monitor_only");
    const bad = await bridgeProposedIntent({ ctx: CTX, intent: intent("integrations.read_deployment_state", { env: "prod" }), plan: AGENCY }, { invoke });
    expect(bad).toEqual({ status: "rejected_by_bridge", reason: "unexpected_arg_key:env" });
  });

  it("missing title still passes the envelope but is rejected by canonical F1 (deny)", async () => {
    const { invoke } = fakeInvoke({ status: "deny", reason: "invalid_arguments" });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.propose_internal_task", {}), plan: AGENCY }, { invoke });
    expect(r).toEqual({ status: "unauthorized", reason: "invalid_arguments" });
  });
});

describe("action-bridge — no `executed` state can occur (fail closed on unexpected allow)", () => {
  it("an 'allow' from a non-read capability ⇒ failed(unexpected_allow), never a silent success", async () => {
    // A confirm capability should never return allow via the bridge, but if F1 ever
    // did, the bridge must not treat it as an execution.
    const { invoke } = fakeInvoke({ status: "allow", result: { created: true }, verification: {} as never });
    const r = await bridgeProposedIntent(
      { ctx: CTX, intent: intent("portal.propose_internal_task", { title: "x" }), plan: AGENCY },
      { invoke }
    );
    expect(r).toEqual({ status: "failed", capabilityId: "portal.propose_internal_task", reason: "unexpected_allow" });
  });

  it("the ActionBridgeResult union has no `executed` status (compile-time + runtime)", async () => {
    // read path is the ONLY allow → read_result; there is no executed branch.
    const { invoke } = fakeInvoke({ status: "allow", result: { inbox: 0 }, verification: {} as never });
    const r = await bridgeProposedIntent({ ctx: CTX, intent: intent("portal.read_task_counts"), plan: AGENCY }, { invoke });
    expect(r.status).toBe("read_result");
    expect(r.status).not.toBe("executed");
  });
});

describe("action-bridge — canonical validator behavior for propose_internal_task (via the real registry)", () => {
  const cap = getCapability("portal.propose_internal_task")!;

  it("accepts exactly { title } and STRIPS a fabricated due_date (never persists it)", () => {
    const parsed = cap.parse({ title: "Call Fine Art tomorrow", due_date: "2026-01-01", when: "friday" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.args).toEqual({ title: "Call Fine Art tomorrow" }); // only title survives
  });

  it("rejects a missing/blank title (canonical validation)", () => {
    expect(cap.parse({}).ok).toBe(false);
    expect(cap.parse({ title: "   " }).ok).toBe(false);
    expect(cap.parse({ title: "x".repeat(201) }).ok).toBe(false);
  });
});
