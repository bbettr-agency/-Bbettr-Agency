import { describe, it, expect, vi, beforeEach } from "vitest";

// createMemory runs under the service role via createAdminClient().rpc(...). Inject a
// fake admin whose rpc is a spy, so we can assert call count + scripted results.
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>): Promise<{ data: string | null; error: unknown }> => ({ data: "mem-1", error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
// events.ts (appendMemoryEvent) is only hit on the reject path; stub to be safe.
vi.mock("./events", () => ({ appendMemoryEvent: vi.fn(async () => {}) }));

import { createMemory, type MemoryActor, type MemoryCreateInput } from "./store";

const actor: MemoryActor = { principalId: "u1", workspaceId: "w1", display: "Jarvis", hasApproveAuthority: false };
const base: MemoryCreateInput = {
  scope: "agency",
  category: "company_knowledge",
  claim: "we bill monthly",
  body: null,
  clientId: null,
  userId: null,
  sourceKind: "model_inference",
};
const KEY = "turn:11111111-1111-4111-8111-111111111111:memory:0";
const HASH = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: "mem-1", error: null });
});

describe("createMemory — F1c idempotency pair coherence (fail fast, no RPC)", () => {
  it("neither key nor hash → legacy 5-arg create (RPC called, no idempotency args)", async () => {
    const r = await createMemory(actor, base);
    expect(r).toMatchObject({ ok: true, id: "mem-1", state: "inferred" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_idempotency_key");
    expect(args).not.toHaveProperty("p_idem_effect_hash");
  });

  it("both key and hash → keyed 7-arg create (RPC called with the idempotency pair)", async () => {
    const r = await createMemory(actor, { ...base, idempotencyKey: KEY, idemEffectHash: HASH });
    expect(r).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_idempotency_key).toBe(KEY);
    expect(args.p_idem_effect_hash).toBe(HASH);
  });

  it("KEY only → fail closed BEFORE the RPC (idempotency_pair_incoherent, RPC count 0)", async () => {
    const r = await createMemory(actor, { ...base, idempotencyKey: KEY });
    expect(r).toEqual({ ok: false, reason: "idempotency_pair_incoherent" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("HASH only → fail closed BEFORE the RPC (idempotency_pair_incoherent, RPC count 0)", async () => {
    const r = await createMemory(actor, { ...base, idemEffectHash: HASH });
    expect(r).toEqual({ ok: false, reason: "idempotency_pair_incoherent" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createMemory — BB68C PostgREST error mapping (TS branch, not the DB concurrency test)", () => {
  it("RPC error code BB68C → typed idempotency_conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "BB68C", message: "idempotency conflict" } });
    const r = await createMemory(actor, { ...base, idempotencyKey: KEY, idemEffectHash: HASH });
    expect(r).toEqual({ ok: false, reason: "idempotency_conflict" });
  });

  it("any OTHER RPC error code → could_not_create_memory (never mislabeled as BB68C)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX999", message: "boom" } });
    const r = await createMemory(actor, { ...base, idempotencyKey: KEY, idemEffectHash: HASH });
    expect(r).toEqual({ ok: false, reason: "could_not_create_memory" });
  });

  it("same key + same effect replay: RPC returns the existing id → ok (no error)", async () => {
    rpc.mockResolvedValueOnce({ data: "mem-existing", error: null });
    const r = await createMemory(actor, { ...base, idempotencyKey: KEY, idemEffectHash: HASH });
    expect(r).toEqual({ ok: true, id: "mem-existing", state: "inferred" });
  });
});
