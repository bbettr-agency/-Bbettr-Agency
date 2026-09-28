import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  computeRequestHash,
  buildResultSnapshot,
  validateResultSnapshot,
  classifyExisting,
  createConversationTurnRepo,
  TurnLinkageError,
  RESULT_MAX_BYTES,
  type TurnRow,
  type TurnResultSnapshot,
} from "./turns";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TurnResult } from "./types";

const okResult = (over: Partial<Extract<TurnResult, { ok: true }>> = {}): Extract<TurnResult, { ok: true }> => ({
  ok: true,
  threadId: "t-1",
  requestId: "req-1",
  assistantMessage: "Here you go.",
  persisted: true,
  ...over,
});

const baseTurn = (over: Partial<TurnRow> = {}): TurnRow => ({
  id: "turn-1",
  workspace_id: "w1",
  user_id: "u1",
  thread_id: "t-1",
  idempotency_key: "k1",
  request_hash: "a".repeat(64),
  correlation_id: "corr-1",
  status: "processing",
  provider_started_at: null,
  user_message_id: null,
  assistant_message_id: null,
  proposal_id: null,
  memory_id: null,
  result: null,
  failure_reason: null,
  ...over,
});

// ── request hash ──
describe("computeRequestHash", () => {
  const env = { workspaceId: "w1", userId: "u1", threadId: "th-1", message: "hello" };
  it("is deterministic lowercase 64-hex", () => {
    const h = computeRequestHash(env);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRequestHash(env)).toBe(h);
  });
  it("same semantic request → same hash", () => {
    expect(computeRequestHash({ ...env })).toBe(computeRequestHash({ ...env }));
  });
  it.each(["workspaceId", "userId", "threadId", "message"] as const)("changing %s changes the hash", (field) => {
    expect(computeRequestHash({ ...env, [field]: env[field] + "X" })).not.toBe(computeRequestHash(env));
  });
  it("omitted thread (null) is a distinct identity from any concrete threadId", () => {
    const nullThread = computeRequestHash({ ...env, threadId: null });
    const withThread = computeRequestHash({ ...env, threadId: "generated-uuid" });
    expect(nullThread).not.toBe(withThread);
    // undefined normalizes to null identity
    expect(computeRequestHash({ ...env, threadId: null })).toBe(computeRequestHash({ workspaceId: "w1", userId: "u1", threadId: null, message: "hello" }));
  });
});

// ── result snapshot ──
describe("result snapshot", () => {
  it("builds from a successful result + trusted provider meta (no prompt/context/secrets)", () => {
    const snap = buildResultSnapshot(
      okResult({ proposedIntent: { capabilityId: "portal.read_task_counts", args: {} }, action: { status: "read_result", capabilityId: "portal.read_task_counts", result: { inbox: 3 } } }),
      { provider: "mock", model: "mock-model", usage: { inputTokens: 1, outputTokens: 2 } }
    );
    expect(snap.v).toBe(1);
    expect(snap.assistantMessage).toBe("Here you go.");
    expect(snap.provider).toBe("mock");
    const keys = Object.keys(snap);
    for (const forbidden of ["prompt", "system", "context", "reasoningSummary", "provenance", "apiKey"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("round-trips through validate", () => {
    const snap = buildResultSnapshot(okResult({ clarification: true }), undefined);
    const parsed = validateResultSnapshot(snap);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.clarification).toBe(true);
  });

  it("rejects malformed stored snapshot (fails closed, never trusts DB JSON)", () => {
    expect(validateResultSnapshot({ v: 2, assistantMessage: "x" })).toEqual({ ok: false, reason: "invalid" });
    expect(validateResultSnapshot({ v: 1 })).toEqual({ ok: false, reason: "invalid" });
    expect(validateResultSnapshot({ v: 1, assistantMessage: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(validateResultSnapshot("not an object")).toEqual({ ok: false, reason: "invalid" });
    expect(validateResultSnapshot({ v: 1, assistantMessage: "x", secretKey: "leak" })).toEqual({ ok: false, reason: "invalid" }); // strict
  });

  it("is FIDELITY-PRESERVING: carries every field verbatim (no reduction, no truncation)", () => {
    // FAIL-CLOSED (F1b locked): buildResultSnapshot never reduces or truncates. The
    // model-authored / free-text fields must survive byte-for-byte.
    const longMsg = "Detailed reasoning ".repeat(50);
    const longArgs = { note: "x".repeat(2_000), items: [1, 2, 3], nested: { deep: "y".repeat(500) } };
    const longBody = "z".repeat(1_500);
    const longNotes = "n".repeat(800);
    const snap = buildResultSnapshot(
      okResult({
        assistantMessage: longMsg,
        uncertainty: { level: "high", notes: longNotes },
        proposedIntent: { capabilityId: "portal.read_task_counts", args: longArgs },
        memoryCandidate: { scope: "client", category: "preference_rule", claim: "prefers mornings", body: longBody },
        action: { status: "approval_required", proposalId: "p-1", capabilityId: "portal.read_task_counts" } as never,
        memory: { status: "needs_confirmation", memoryId: "m-1" } as never,
      }),
      { provider: "anthropic", model: "sonnet", usage: { inputTokens: 10, outputTokens: 20 } }
    );
    // Every field is present and unmodified.
    expect(snap.assistantMessage).toBe(longMsg);
    expect(snap.uncertainty).toEqual({ level: "high", notes: longNotes });
    expect(snap.proposedIntent).toEqual({ capabilityId: "portal.read_task_counts", args: longArgs });
    expect(snap.memoryCandidate).toEqual({ scope: "client", category: "preference_rule", claim: "prefers mornings", body: longBody });
    expect(snap.action).toEqual({ status: "approval_required", proposalId: "p-1", capabilityId: "portal.read_task_counts" });
    expect(snap.memory).toEqual({ status: "needs_confirmation", memoryId: "m-1" });
    expect(snap.provider).toBe("anthropic");
    // No lossy marker exists anymore.
    expect("truncated" in snap).toBe(false);
    // This snapshot fits, so validation passes and round-trips unchanged.
    const parsed = validateResultSnapshot(snap);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(snap);
  });

  it("validate REJECTS an oversized faithful snapshot as too_large with EXACT UTF-8 bytes (no lossy substitute)", () => {
    // 20000 × 3-byte '€' = 20000 chars but 60000 bytes → over the ceiling by bytes.
    const huge = "€".repeat(20_000);
    const snap = buildResultSnapshot(okResult({ assistantMessage: huge }), { provider: "mock", model: "m", usage: null });
    // buildResultSnapshot did NOT truncate — the full message is still present.
    expect(snap.assistantMessage).toBe(huge);
    expect("truncated" in snap).toBe(false);
    // char-length would have been < ceiling (20000 chars) — prove the guard is byte-based.
    expect(huge.length).toBeLessThan(RESULT_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(snap), "utf8")).toBeGreaterThan(RESULT_MAX_BYTES);
    // Fail closed: sizing rejects it; the caller must transition to failed, not store it.
    expect(validateResultSnapshot(snap)).toEqual({ ok: false, reason: "too_large" });
  });

  it("validate rejects a raw oversized snapshot as too_large", () => {
    const oversized = { v: 1, assistantMessage: "y".repeat(RESULT_MAX_BYTES + 100) } as unknown;
    expect(validateResultSnapshot(oversized)).toEqual({ ok: false, reason: "too_large" });
  });
});

// ── classify existing ──
describe("classifyExisting", () => {
  const HASH = "a".repeat(64);
  it("hash mismatch → conflict (no stored data)", () => {
    expect(classifyExisting(baseTurn({ request_hash: "b".repeat(64) }), HASH)).toEqual({ kind: "conflict" });
  });
  it("completed + valid result → completed_replay (reconstructed TurnResult)", () => {
    const snap: TurnResultSnapshot = { v: 1, assistantMessage: "done", action: { status: "not_requested" }, memory: { status: "not_requested" } };
    const c = classifyExisting(baseTurn({ status: "completed", result: snap }), HASH);
    expect(c.kind).toBe("completed_replay");
    if (c.kind === "completed_replay") {
      expect(c.result.ok).toBe(true);
      expect(c.result.assistantMessage).toBe("done");
      expect(c.result.requestId).toBe("corr-1");
    }
  });
  it("completed + UNVALIDATABLE stored result → corrupt (fail closed)", () => {
    const c = classifyExisting(baseTurn({ status: "completed", result: { garbage: true } }), HASH);
    expect(c.kind).toBe("corrupt");
  });
  it("processing → in_progress", () => {
    expect(classifyExisting(baseTurn({ status: "processing" }), HASH)).toMatchObject({ kind: "in_progress", turnId: "turn-1" });
  });
  it("failed → failed_replay with reason", () => {
    expect(classifyExisting(baseTurn({ status: "failed", failure_reason: "provider_5xx" }), HASH)).toMatchObject({ kind: "failed_replay", reason: "provider_5xx" });
  });
  it("abandoned → abandoned_replay", () => {
    expect(classifyExisting(baseTurn({ status: "abandoned", failure_reason: "stale" }), HASH)).toMatchObject({ kind: "abandoned_replay", reason: "stale" });
  });
});

// ── repository mapping (fake supabase) ──
function fakeAdmin(opts: { upsert?: { data: unknown[] | null; error: unknown }; existing?: { data: unknown; error: unknown }; updateError?: unknown }) {
  // Each .from() gets its own builder so upsert().select() (resolves) is distinct
  // from a plain select().eq()...maybeSingle() chain.
  const makeBuilder = () => {
    let isUpsert = false;
    const b: Record<string, unknown> = {};
    b.upsert = () => { isUpsert = true; return b; };
    b.update = () => b;
    b.select = () => (isUpsert ? Promise.resolve(opts.upsert) : b);
    b.eq = () => {
      // chainable (select path) AND awaitable (update path ends at .eq)
      const p: Record<string, unknown> = { eq: () => p, maybeSingle: () => Promise.resolve(opts.existing) };
      (p as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ error: opts.updateError ?? null }).then(res);
      return p;
    };
    return b;
  };
  return { from: vi.fn(() => makeBuilder()) };
}

describe("createConversationTurnRepo", () => {
  const ctx = { principalId: "u1", workspaceId: "w1", grants: new Set<string>() };
  const claimInput = { ctx, idempotencyKey: "k1", requestHash: "a".repeat(64), correlationId: "corr-1", leaseExpiresAt: new Date().toISOString() };

  it("claim: INSERT wins → outcome 'claimed'", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ upsert: { data: [baseTurn()], error: null } }) as never);
    const r = await createConversationTurnRepo().claim(claimInput);
    expect(r.outcome).toBe("claimed");
  });

  it("claim: conflict (no insert) → SELECT existing → outcome 'existing'", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ upsert: { data: [], error: null }, existing: { data: baseTurn({ status: "processing" }), error: null } }) as never);
    const r = await createConversationTurnRepo().claim(claimInput);
    expect(r.outcome).toBe("existing");
  });

  it("set-once linkage: a BB68S DB error maps to TurnLinkageError", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ updateError: { code: "BB68S", message: "set-once" } }) as never);
    await expect(createConversationTurnRepo().setThreadId("turn-1", "th-2")).rejects.toBeInstanceOf(TurnLinkageError);
  });
});
