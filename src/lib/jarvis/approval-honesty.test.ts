import { describe, it, expect, beforeEach, vi } from "vitest";
import { canonicalEffectHash } from "./hash";

/**
 * End-to-end approval-honesty proof for approveAndExecuteProposal.
 *
 * Real policy / registry / hash / verification / handler run; only the I/O seams
 * are faked: a stateful in-memory `jarvis_proposals` row (so we can assert the
 * proposal's final state), the audit sink, the server client, and the ONE legal
 * task-write path `runTaskCommand` (whose ok:true/ok:false result drives the
 * handler). This proves Jarvis records the TRUTH of the underlying operation.
 */
const H = vi.hoisted(() => {
  const store: { proposal: Record<string, unknown> | null } = { proposal: null };

  // Minimal chainable fake of the supabase admin client covering the exact chains
  // approveAndExecuteProposal uses: read (.select.eq.eq.maybeSingle), guarded
  // claim (.update.eq.eq.select), guarded execute (.update.eq.eq), and the
  // unguarded failure write (.update.eq).
  function makeAdmin() {
    function from() {
      const st: { op: "read" | "update" | "insert" | null; patch: Record<string, unknown> | null; filters: Record<string, unknown> } = {
        op: null,
        patch: null,
        filters: {},
      };
      const exec = () => {
        const cur = store.proposal;
        if (st.op === "read") return { data: cur ? { ...cur } : null, error: null };
        if (st.op === "update") {
          const guard = st.filters.status;
          if (!cur) return { data: [], error: null };
          if (guard !== undefined && cur.status !== guard) return { data: [], error: null }; // guard failed (race/no-op)
          store.proposal = { ...cur, ...st.patch };
          return { data: [{ id: cur.id }], error: null };
        }
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {
        select() { if (st.op === null) st.op = "read"; return b; },
        insert() { st.op = "insert"; return b; },
        update(patch: Record<string, unknown>) { st.op = "update"; st.patch = patch; return b; },
        eq(col: string, val: unknown) { st.filters[col] = val; return b; },
        maybeSingle() { return Promise.resolve(exec()); },
        single() { return Promise.resolve(exec()); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(exec()).then(res, rej); },
      };
      return b;
    }
    return { from };
  }

  return { store, makeAdmin, runTaskCommand: vi.fn(), appendJarvisAction: vi.fn(async (_x: unknown) => {}) };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => H.makeAdmin() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: (...a: unknown[]) => H.runTaskCommand(...a) }));
vi.mock("./audit", () => ({ appendJarvisAction: (x: unknown) => H.appendJarvisAction(x), readRecentJarvisActions: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { approveAndExecuteProposal } from "./proposals";
import type { JarvisContext } from "./identity";

const CAP = "portal.propose_internal_task";
const ARGS = { title: "TEST — approval honesty" };
const EFFECT_HASH = canonicalEffectHash({ capabilityId: CAP, args: ARGS });

// Approver holds the required capability grant AND approval authority.
const ctx: JarvisContext = {
  principalId: "approver-1",
  workspaceId: "w1",
  grants: new Set(["jarvis.use", "portal.tasks.write", "jarvis.approve"]),
};

function seedPending(overrides: Record<string, unknown> = {}) {
  H.store.proposal = {
    id: "prop-1",
    workspace_id: "w1",
    capability_id: CAP,
    args: ARGS,
    effect: { capabilityId: CAP, args: ARGS },
    effect_hash: EFFECT_HASH,
    status: "pending",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    verification_state: "not_required",
    ...overrides,
  };
}

const lastAudit = () => H.appendJarvisAction.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  H.store.proposal = null;
});

describe("approveAndExecuteProposal — truthful execution accounting", () => {
  it("F+A: successful runTaskCommand → executed, success=true, verification=verified", async () => {
    H.runTaskCommand.mockResolvedValue({ ok: true, outcome: "applied", taskId: "task-abc", aggregateVersion: 1 });
    seedPending();

    const r = (await approveAndExecuteProposal(ctx, "prop-1")) as { ok: boolean; verified?: boolean; verification?: { state: string } };
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.verification?.state).toBe("verified");

    expect(H.store.proposal?.status).toBe("executed");
    expect(H.store.proposal?.verification_state).toBe("verified");

    expect(lastAudit()).toMatchObject({ executed: true, success: true, verificationState: "verified" });
    expect(H.runTaskCommand).toHaveBeenCalledTimes(1);
  });

  it("B+C+D: failed runTaskCommand (ok:false) → NOT success, proposal=failed, useful error, verification=failed", async () => {
    H.runTaskCommand.mockResolvedValue({ ok: false, code: "TasksDisabled", error: "Tasks are disabled" });
    seedPending();

    const r = (await approveAndExecuteProposal(ctx, "prop-1")) as { ok: boolean; reason?: string };
    expect(r).toMatchObject({ ok: false, reason: "execution_failed" });

    // C: proposal must NOT end in a success-implying state.
    expect(H.store.proposal?.status).toBe("failed");
    expect(H.store.proposal?.status).not.toBe("executed");
    // D: useful, specific failure info recorded (safe typed code, no raw DB text).
    expect(String(H.store.proposal?.error)).toMatch(/TasksDisabled/);
    // No false verification state.
    expect(H.store.proposal?.verification_state).toBe("failed");

    const audit = lastAudit()!;
    expect(audit).toMatchObject({ executed: true, success: false, verificationState: "failed" });
    expect(String(audit.error)).toMatch(/TasksDisabled/);

    // B: success=true is never recorded anywhere on a failed execution.
    const anySuccess = H.appendJarvisAction.mock.calls.some((c) => (c[0] as { success?: unknown }).success === true);
    expect(anySuccess).toBe(false);
  });

  it("E: single-use — a proposal already executed cannot be replayed and causes NO second side effect", async () => {
    H.runTaskCommand.mockResolvedValue({ ok: true, outcome: "applied", taskId: "task-abc", aggregateVersion: 1 });
    seedPending();

    const r1 = (await approveAndExecuteProposal(ctx, "prop-1")) as { ok: boolean };
    expect(r1.ok).toBe(true);
    expect(H.store.proposal?.status).toBe("executed");

    H.runTaskCommand.mockClear();
    const r2 = (await approveAndExecuteProposal(ctx, "prop-1")) as { ok: boolean; reason?: string };
    expect(r2).toMatchObject({ ok: false, reason: "not_pending" });
    expect(H.runTaskCommand).not.toHaveBeenCalled(); // no re-execution / retry
  });

  it("E(2): a proposal left FAILED also cannot be re-approved (no retry into success)", async () => {
    H.runTaskCommand.mockResolvedValue({ ok: false, code: "VersionConflict", error: "x" });
    seedPending();
    await approveAndExecuteProposal(ctx, "prop-1");
    expect(H.store.proposal?.status).toBe("failed");

    H.runTaskCommand.mockClear();
    const r = (await approveAndExecuteProposal(ctx, "prop-1")) as { ok: boolean; reason?: string };
    expect(r).toMatchObject({ ok: false, reason: "not_pending" });
    expect(H.runTaskCommand).not.toHaveBeenCalled();
  });
});
