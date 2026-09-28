import { describe, it, expect } from "vitest";
import { chatRequestSchema, mapOutcomeToResponse, mapFailureReason, MESSAGE_MAX_CHARS } from "./transport";
import type { DurableTurnOutcome } from "./orchestrator";
import type { TurnResult } from "./types";

const KEY = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";

const okResult = (over: Partial<Extract<TurnResult, { ok: true }>> = {}): Extract<TurnResult, { ok: true }> => ({
  ok: true,
  threadId: THREAD,
  requestId: "corr-1",
  assistantMessage: "Here you go.",
  persisted: true,
  ...over,
});

// ── request schema ──
describe("chatRequestSchema", () => {
  it("accepts the minimal valid request and trims the message", () => {
    const r = chatRequestSchema.safeParse({ message: "  hello  ", idempotencyKey: KEY });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.message).toBe("hello"); // trimmed to match F1b hash input
      expect(r.data.threadId).toBeUndefined(); // omitted stays omitted
    }
  });
  it("accepts an optional valid threadId", () => {
    const r = chatRequestSchema.safeParse({ message: "hi", threadId: THREAD, idempotencyKey: KEY });
    expect(r.success && r.data.threadId).toBe(THREAD);
  });
  it("rejects a missing idempotencyKey", () => {
    expect(chatRequestSchema.safeParse({ message: "hi" }).success).toBe(false);
  });
  it("rejects a malformed idempotencyKey", () => {
    expect(chatRequestSchema.safeParse({ message: "hi", idempotencyKey: "not-a-uuid" }).success).toBe(false);
  });
  it("rejects a malformed threadId", () => {
    expect(chatRequestSchema.safeParse({ message: "hi", threadId: "nope", idempotencyKey: KEY }).success).toBe(false);
  });
  it("rejects a missing / empty / whitespace message", () => {
    expect(chatRequestSchema.safeParse({ idempotencyKey: KEY }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "", idempotencyKey: KEY }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "   ", idempotencyKey: KEY }).success).toBe(false);
  });
  it("rejects a message over the char ceiling (after trim)", () => {
    expect(chatRequestSchema.safeParse({ message: "x".repeat(MESSAGE_MAX_CHARS + 1), idempotencyKey: KEY }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "x".repeat(MESSAGE_MAX_CHARS), idempotencyKey: KEY }).success).toBe(true);
  });
  it("REJECTS unknown keys (strict) — no smuggled authority", () => {
    for (const extra of ["workspaceId", "userId", "principalId", "clientId", "provider", "model", "operationKey", "proposalId", "memoryId", "turnId", "requestHash", "correlationId", "context", "reasoning"]) {
      const r = chatRequestSchema.safeParse({ message: "hi", idempotencyKey: KEY, [extra]: "x" });
      expect(r.success, extra).toBe(false);
    }
  });
  it("rejects arrays and primitives", () => {
    expect(chatRequestSchema.safeParse([]).success).toBe(false);
    expect(chatRequestSchema.safeParse("hi").success).toBe(false);
    expect(chatRequestSchema.safeParse(42).success).toBe(false);
  });
});

// ── failure taxonomy ──
describe("mapFailureReason", () => {
  it.each([
    ["timeout", 504, "provider_timeout"],
    ["rate_limit", 429, "rate_limited"],
    ["unavailable", 503, "provider_unavailable"],
    ["configuration", 503, "provider_unavailable"],
    ["provider_4xx", 502, "provider_error"],
    ["provider_5xx", 502, "provider_error"],
    ["invalid_response", 502, "provider_invalid_response"],
    ["context_unavailable", 503, "context_unavailable"],
    ["thread_not_found", 404, "thread_not_found"],
    ["provider_start_failed", 500, "internal_error"],
    ["persist_failed", 500, "internal_error"],
    ["result_too_large", 500, "internal_error"],
    ["something_unexpected", 500, "internal_error"],
  ] as const)("%s → %i %s", (reason, status, code) => {
    expect(mapFailureReason(reason)).toEqual({ status, code });
  });
});

// ── outcome mapper ──
describe("mapOutcomeToResponse", () => {
  it("executed ok:true (new) → 200 completed replay:false with allow-listed fields only", () => {
    const outcome: DurableTurnOutcome = {
      kind: "executed",
      turnId: "turn-1",
      result: okResult({
        uncertainty: { level: "high", notes: "unsure" },
        proposedIntent: { capabilityId: "portal.propose_internal_task", args: { title: "secret args" } },
        memoryCandidate: { scope: "agency", category: "company_knowledge", claim: "c" },
        action: { status: "approval_required", capabilityId: "portal.propose_internal_task", proposalId: "prop-1" },
        memory: { status: "needs_confirmation", memoryId: "mem-1", state: "inferred" },
      }),
    };
    const r = mapOutcomeToResponse(outcome);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      status: "completed",
      replay: false,
      requestId: "corr-1",
      threadId: THREAD,
      assistantMessage: "Here you go.",
      uncertainty: { level: "high", notes: "unsure" },
      action: { status: "approval_required", capabilityId: "portal.propose_internal_task", proposalId: "prop-1" },
      memory: { status: "needs_confirmation", memoryId: "mem-1" },
    });
    const s = JSON.stringify(r.body);
    // Nothing leaked: raw args, memoryCandidate, state, provider/model/usage, reason.
    for (const forbidden of ["secret args", "memoryCandidate", "proposedIntent", "inferred", "reasoningSummary", "provider", "usage"]) {
      expect(s).not.toContain(forbidden);
    }
  });

  it("completed_replay → 200 completed replay:true", () => {
    const r = mapOutcomeToResponse({ kind: "completed_replay", turnId: "t", result: okResult() });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "completed", replay: true, requestId: "corr-1", threadId: THREAD });
  });

  it("clarification marker survives when present", () => {
    const r = mapOutcomeToResponse({ kind: "executed", turnId: "t", result: okResult({ clarification: true }) });
    expect((r.body as { clarification?: true }).clarification).toBe(true);
  });

  it("in_progress → 202 processing + turnId (no requestId)", () => {
    const r = mapOutcomeToResponse({ kind: "in_progress", turnId: "turn-9" });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: "processing", turnId: "turn-9" });
    expect(JSON.stringify(r.body)).not.toContain("requestId");
  });

  it("conflict → 409 with NO ids", () => {
    const r = mapOutcomeToResponse({ kind: "conflict" });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "idempotency_conflict" });
  });

  it("abandoned_replay → 409 turn_abandoned replay:true", () => {
    const r = mapOutcomeToResponse({ kind: "abandoned_replay", turnId: "turn-a", reason: "stale" });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "turn_abandoned", replay: true, turnId: "turn-a" });
  });

  it("failed_replay maps every known failure reason (replay:true + turnId, raw reason absent)", () => {
    const cases: Array<[string, number, string]> = [
      ["timeout", 504, "provider_timeout"],
      ["rate_limit", 429, "rate_limited"],
      ["unavailable", 503, "provider_unavailable"],
      ["provider_5xx", 502, "provider_error"],
      ["invalid_response", 502, "provider_invalid_response"],
      ["context_unavailable", 503, "context_unavailable"],
      ["thread_not_found", 404, "thread_not_found"],
      ["result_too_large", 500, "internal_error"],
    ];
    for (const [reason, status, code] of cases) {
      const r = mapOutcomeToResponse({ kind: "failed_replay", turnId: "turn-f", reason });
      expect(r.status).toBe(status);
      expect(r.body).toEqual({ error: code, replay: true, turnId: "turn-f" });
    }
  });

  it("executed ok:false maps by reason (requestId only when present)", () => {
    const withId = mapOutcomeToResponse({ kind: "executed", turnId: "t", result: { ok: false, reason: "timeout", requestId: "corr-2" } });
    expect(withId.status).toBe(504);
    expect(withId.body).toEqual({ error: "provider_timeout", requestId: "corr-2" });
    const noId = mapOutcomeToResponse({ kind: "executed", turnId: "t", result: { ok: false, reason: "persist_failed" } });
    expect(noId.status).toBe(500);
    expect(noId.body).toEqual({ error: "internal_error" });
  });

  it("disabled/not_authorized/invalid_input backstops", () => {
    expect(mapOutcomeToResponse({ kind: "disabled" })).toEqual({ status: 404, body: { error: "not_found" } });
    expect(mapOutcomeToResponse({ kind: "not_authorized", reason: "not_enabled" })).toEqual({ status: 403, body: { error: "jarvis_unavailable" } });
    expect(mapOutcomeToResponse({ kind: "invalid_input", reason: "empty_message" })).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("does NOT expose read_result raw result blob", () => {
    const r = mapOutcomeToResponse({
      kind: "executed",
      turnId: "t",
      result: okResult({ action: { status: "read_result", capabilityId: "portal.read_task_counts", result: { inbox: 3, secret: "x" } } }),
    });
    expect((r.body as { action?: unknown }).action).toEqual({ status: "read_result", capabilityId: "portal.read_task_counts" });
    expect(JSON.stringify(r.body)).not.toContain("inbox");
  });
});
