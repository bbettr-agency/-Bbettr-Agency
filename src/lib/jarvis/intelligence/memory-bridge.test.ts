import { describe, it, expect, vi } from "vitest";

// The bridge statically imports the Memory store (→ supabase). We inject the
// create seam, so stub the supabase modules whose import would otherwise load.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { bridgeMemoryCandidate, MEMORY_MODEL_DISPLAY } from "./memory-bridge";
import type { MemoryActor, MemoryCreateInput, MemoryWriteResult } from "@/lib/jarvis/memory/store";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan, ValidatedMemoryCandidate } from "./types";

const GRANTS = ["jarvis.use", "memory.read", "memory.propose"];
const CTX: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(GRANTS) };
const AGENCY: ContextPlan = { kind: "agency" };
const CLIENT: ContextPlan = { kind: "client", clientId: "c-1", clientName: "Acme" };

function candidate(over: Partial<ValidatedMemoryCandidate> = {}): ValidatedMemoryCandidate {
  return { scope: "agency", category: "company_knowledge", claim: "We bill monthly", ...over };
}

/** A create seam that records the input and returns a scripted result. */
function fakeCreate(result: MemoryWriteResult) {
  const calls: Array<{ actor: MemoryActor; input: MemoryCreateInput }> = [];
  const create = vi.fn(async (actor: MemoryActor, input: MemoryCreateInput) => {
    calls.push({ actor, input });
    return result;
  });
  return { create, calls };
}

const okInferred: MemoryWriteResult = { ok: true, id: "mem-1", state: "inferred" };

describe("memory-bridge — gate + authorization", () => {
  it("no memory_candidate ⇒ not_requested", async () => {
    const { create } = fakeCreate(okInferred);
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: undefined, plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "not_requested" });
    expect(create).not.toHaveBeenCalled();
  });

  it("principal lacking memory.propose ⇒ unauthorized, no write", async () => {
    const { create } = fakeCreate(okInferred);
    const ctx: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use", "memory.read"]) };
    const r = await bridgeMemoryCandidate({ ctx, candidate: candidate(), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "unauthorized", reason: "missing_memory_propose" });
    expect(create).not.toHaveBeenCalled();
  });

  it("revalidates category at the mutation boundary (rejects a bad category)", async () => {
    const { create } = fakeCreate(okInferred);
    const bad = { scope: "agency", category: "made_up", claim: "x" } as unknown as ValidatedMemoryCandidate;
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: bad, plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "rejected", reason: "invalid_category" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("memory-bridge — trusted scope binding (model never controls ids)", () => {
  it("agency scope binds workspace only (no client/user ids)", async () => {
    const { create, calls } = fakeCreate(okInferred);
    await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate({ scope: "agency" }), plan: AGENCY, requestId: "req-1" }, { create });
    expect(calls[0].input.clientId).toBeNull();
    expect(calls[0].input.userId).toBeNull();
    expect(calls[0].actor.workspaceId).toBe("w1");
  });

  it("user scope binds the AUTHENTICATED principal (never a model-supplied user)", async () => {
    const { create, calls } = fakeCreate(okInferred);
    await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate({ scope: "user", category: "preference_rule" }), plan: AGENCY, requestId: "req-1" }, { create });
    expect(calls[0].input.userId).toBe("u1");
    expect(calls[0].input.clientId).toBeNull();
  });

  it("client scope binds the DETERMINISTICALLY RESOLVED client id from the turn plan", async () => {
    const { create, calls } = fakeCreate(okInferred);
    await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate({ scope: "client", category: "client_knowledge" }), plan: CLIENT, requestId: "req-1" }, { create });
    expect(calls[0].input.clientId).toBe("c-1");
    expect(calls[0].input.userId).toBeNull();
  });

  it("client scope WITHOUT a resolved client in the turn ⇒ rejected (no inference from claim text)", async () => {
    const { create } = fakeCreate(okInferred);
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate({ scope: "client", category: "client_knowledge" }), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "rejected", reason: "client_scope_without_resolved_client" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("memory-bridge — provenance, state, secrets, correlation", () => {
  it("always submits sourceKind=model_inference and a trusted source_ref (turn correlation)", async () => {
    const { create, calls } = fakeCreate(okInferred);
    await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate(), plan: AGENCY, requestId: "req-abc" }, { create });
    expect(calls[0].input.sourceKind).toBe("model_inference");
    expect(calls[0].input.sourceRef).toBe("jarvis:turn:req-abc");
    expect(calls[0].actor.display).toBe(MEMORY_MODEL_DISPLAY);
  });

  it("does NOT let the candidate carry id/workspace/user/client/provenance/state (shape has only 4 fields)", async () => {
    const { create, calls } = fakeCreate(okInferred);
    // Even if extra keys were smuggled onto the object, the bridge only reads the 4 known fields.
    const sneaky = { scope: "agency", category: "company_knowledge", claim: "x", client_id: "evil", user_id: "evil", state: "confirmed", provenance: "human" } as unknown as ValidatedMemoryCandidate;
    await bridgeMemoryCandidate({ ctx: CTX, candidate: sneaky, plan: AGENCY, requestId: "req-1" }, { create });
    const input = calls[0].input as unknown as Record<string, unknown>;
    expect(input.clientId).toBeNull();
    expect(input.userId).toBeNull();
    expect(input).not.toHaveProperty("state");
    expect(input).not.toHaveProperty("provenance");
    expect(input.sourceKind).toBe("model_inference");
  });

  it("a successful create ⇒ needs_confirmation with the (inferred) state — never auto-confirmed", async () => {
    const { create } = fakeCreate(okInferred);
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate(), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "needs_confirmation", memoryId: "mem-1", state: "inferred" });
    // The bridge has no confirm path at all.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a secret rejection from the Memory layer ⇒ rejected, with safe category labels only", async () => {
    const { create } = fakeCreate({ ok: false, reason: "prohibited_secret", secretCategories: ["api_key"] });
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate({ claim: "token sk-abc" }), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "rejected", reason: "prohibited_secret", secretCategories: ["api_key"] });
  });

  it("a create that throws ⇒ failed (never claims saved)", async () => {
    const create = vi.fn(async () => { throw new Error("db down"); });
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate(), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toEqual({ status: "failed", reason: "bridge_invocation_failed" });
  });
});

describe("memory-bridge — duplicate/conflict HONESTY (no invented detection)", () => {
  it("the same candidate submitted twice remains TWO separate inferred candidates (no bridge dedup)", async () => {
    // The underlying createMemory does a plain INSERT (no uniqueness/dedup), so each
    // call is a distinct row. The bridge must forward both, never collapse them.
    let n = 0;
    const create = vi.fn(async () => ({ ok: true as const, id: `mem-${++n}`, state: "inferred" }));
    const c = candidate();
    const r1 = await bridgeMemoryCandidate({ ctx: CTX, candidate: c, plan: AGENCY, requestId: "req-1" }, { create });
    const r2 = await bridgeMemoryCandidate({ ctx: CTX, candidate: c, plan: AGENCY, requestId: "req-2" }, { create });
    expect(r1).toEqual({ status: "needs_confirmation", memoryId: "mem-1", state: "inferred" });
    expect(r2).toEqual({ status: "needs_confirmation", memoryId: "mem-2", state: "inferred" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("the bridge never emits a `duplicate` or `conflict` status (the Memory API returns neither on create)", async () => {
    const { create } = fakeCreate(okInferred);
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate(), plan: AGENCY, requestId: "req-1" }, { create });
    expect(["duplicate", "conflict"]).not.toContain(r.status);
    expect(r.status).toBe("needs_confirmation");
  });

  it("never auto-confirms / auto-supersedes: state stays `inferred`, and only createMemory is ever called", async () => {
    const { create, calls } = fakeCreate(okInferred);
    const r = await bridgeMemoryCandidate({ ctx: CTX, candidate: candidate(), plan: AGENCY, requestId: "req-1" }, { create });
    expect(r).toMatchObject({ status: "needs_confirmation", state: "inferred" });
    // The bridge's ONLY Memory dependency is the create seam — there is no confirm/
    // supersede/retire/flagConflict path reachable from it.
    expect(calls).toHaveLength(1);
  });
});
