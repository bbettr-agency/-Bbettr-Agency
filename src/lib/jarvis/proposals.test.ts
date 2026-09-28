import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// Cut the server-only side-effect graph (handlers → planner → auth/React cache).
vi.mock("./handlers", () => ({ getHandler: () => null }));
vi.mock("./audit", () => ({ appendJarvisAction: vi.fn(async () => {}) }));

import { createProposal } from "./proposals";
import { canonicalEffectHash } from "./hash";
import { createAdminClient } from "@/lib/supabase/admin";

const ctx = { principalId: "p1", workspaceId: "w1", grants: new Set<string>() };
const CAP = "portal.propose_internal_task";
const ARGS = { title: "Do it" };
const EFFECT_HASH = canonicalEffectHash({ capabilityId: CAP, args: ARGS });
const OP_KEY = "turn:11111111-1111-4111-8111-111111111111:action:0";

/**
 * Fake admin whose jarvis_proposals builder distinguishes:
 *  • legacy .insert(...).select("id").single()
 *  • idempotent .upsert(...).select("id")  (resolves to an array)
 *  • existing lookup .select("id, effect_hash, status").eq(...).maybeSingle()
 * Records the last write so tests can assert "no mutation on conflict".
 */
function fakeAdmin(opts: {
  upsert?: { data: unknown[] | null; error: unknown };
  existing?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
}) {
  const writes: Array<{ kind: string; payload?: unknown }> = [];
  const makeBuilder = () => {
    let mode: "none" | "upsert" | "insert" = "none";
    const b: Record<string, unknown> = {};
    b.upsert = (payload: unknown) => { mode = "upsert"; writes.push({ kind: "upsert", payload }); return b; };
    b.insert = (payload: unknown) => { mode = "insert"; writes.push({ kind: "insert", payload }); return b; };
    b.update = (payload: unknown) => { writes.push({ kind: "update", payload }); return b; };
    b.select = () => {
      if (mode === "upsert") return Promise.resolve(opts.upsert);
      if (mode === "insert") return { single: () => Promise.resolve(opts.insert) };
      // existing lookup chain
      return b;
    };
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve(opts.existing);
    return b;
  };
  return { admin: { from: vi.fn(() => makeBuilder()) }, writes };
}

beforeEach(() => vi.clearAllMocks());

describe("createProposal — legacy (no operation key)", () => {
  it("plain INSERT → outcome 'created' (unchanged behavior)", async () => {
    const { admin } = fakeAdmin({ insert: { data: { id: "prop-legacy" }, error: null } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, ARGS, "why");
    expect(r).toEqual({ outcome: "created", id: "prop-legacy", effectHash: EFFECT_HASH });
  });
});

describe("createProposal — idempotent get-or-create (operation key)", () => {
  it("INSERT wins → outcome 'created' with the freshly computed effect hash", async () => {
    const { admin, writes } = fakeAdmin({ upsert: { data: [{ id: "prop-new" }], error: null } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, ARGS, "why", OP_KEY);
    expect(r).toEqual({ outcome: "created", id: "prop-new", effectHash: EFFECT_HASH });
    // The write carried the trusted operation key + the canonical effect hash.
    const up = writes.find((w) => w.kind === "upsert")?.payload as Record<string, unknown>;
    expect(up.idempotency_key).toBe(OP_KEY);
    expect(up.effect_hash).toBe(EFFECT_HASH);
  });

  it("conflict + SAME effect + existing PENDING → outcome 'reused' (same id)", async () => {
    const { admin } = fakeAdmin({
      upsert: { data: [], error: null },
      existing: { data: { id: "prop-existing", effect_hash: EFFECT_HASH, status: "pending" }, error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, ARGS, "why", OP_KEY);
    expect(r).toEqual({ outcome: "reused", id: "prop-existing", effectHash: EFFECT_HASH, status: "pending" });
  });

  it("conflict + SAME effect + existing NON-PENDING → outcome 'reused' with the true status", async () => {
    const { admin } = fakeAdmin({
      upsert: { data: [], error: null },
      existing: { data: { id: "prop-executed", effect_hash: EFFECT_HASH, status: "executed" }, error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, ARGS, "why", OP_KEY);
    // The lifecycle state is reported truthfully; dispatch decides how to represent it.
    expect(r).toEqual({ outcome: "reused", id: "prop-executed", effectHash: EFFECT_HASH, status: "executed" });
  });

  it("conflict + DIFFERENT effect → outcome 'conflict' and NO mutation of the existing row", async () => {
    const { admin, writes } = fakeAdmin({
      upsert: { data: [], error: null },
      existing: { data: { id: "prop-existing", effect_hash: "b".repeat(64), status: "pending" }, error: null },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, ARGS, "why", OP_KEY);
    expect(r).toEqual({ outcome: "conflict" });
    // Fail closed: only the (ignored) upsert attempt happened; never an update/replace.
    expect(writes.some((w) => w.kind === "update")).toBe(false);
    expect(writes.some((w) => w.kind === "insert")).toBe(false);
  });

  it("raw model extras do not change identity: effect hash is over the CANONICAL args passed", async () => {
    // dispatch passes cap.parse(rawArgs).args (canonical). Same canonical args ⇒ same hash
    // regardless of what raw JSON the model sent.
    const { admin } = fakeAdmin({ upsert: { data: [{ id: "p" }], error: null } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await createProposal(ctx, CAP, { title: "Do it" }, undefined, OP_KEY);
    expect(r).toMatchObject({ outcome: "created", effectHash: canonicalEffectHash({ capabilityId: CAP, args: { title: "Do it" } }) });
  });
});
