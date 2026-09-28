import { describe, it, expect } from "vitest";
import { newSubmission, toRequestBody, adoptThreadId, mapResponse, errorCopy, MESSAGE_MAX_CHARS } from "./jarvis-chat-turn";

const THREAD = "22222222-2222-4222-8222-222222222222";

describe("newSubmission / toRequestBody — idempotency & thread semantics", () => {
  it("trims the message and mints a key", () => {
    let n = 0;
    const s = newSubmission("  hi  ", undefined, () => `k${++n}`);
    expect(s).toEqual({ message: "hi", idempotencyKey: "k1", threadIdSent: undefined });
  });

  it("each NEW submission gets a FRESH key", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 5; i++) keys.add(newSubmission("m", undefined).idempotencyKey);
    expect(keys.size).toBe(5);
  });

  it("first-turn body OMITS threadId", () => {
    const s = newSubmission("hi", undefined, () => "k");
    expect(toRequestBody(s)).toEqual({ message: "hi", idempotencyKey: "k" });
    expect("threadId" in toRequestBody(s)).toBe(false);
  });

  it("continuation snapshots the current session thread + a fresh key", () => {
    const s = newSubmission("hi", THREAD, () => "k2");
    expect(toRequestBody(s)).toEqual({ message: "hi", idempotencyKey: "k2", threadId: THREAD });
  });

  it("RETRY replays the SAME submission verbatim (same key, message, threadIdSent)", () => {
    const s = newSubmission("do it", THREAD, () => "kSame");
    // "retry" = re-send the same object; body must be byte-identical.
    expect(toRequestBody(s)).toEqual(toRequestBody(s));
    expect(toRequestBody(s)).toEqual({ message: "do it", idempotencyKey: "kSame", threadId: THREAD });
  });

  it("first-turn RETRY still OMITS threadId even after a thread was returned", () => {
    // The submission was created with threadIdSent=undefined; adopting a session thread
    // afterwards must NOT change what THIS submission replays.
    const s = newSubmission("hi", undefined, () => "k1");
    const session = adoptThreadId(undefined, THREAD); // a later completed turn set the session thread
    expect(session).toBe(THREAD);
    // Retrying the original submission still omits threadId:
    expect("threadId" in toRequestBody(s)).toBe(false);
  });
});

describe("adoptThreadId", () => {
  it("adopts the returned thread only when none is set", () => {
    expect(adoptThreadId(undefined, THREAD)).toBe(THREAD);
    expect(adoptThreadId("existing", THREAD)).toBe("existing");
  });
});

describe("mapResponse", () => {
  const completed = { status: "completed", replay: false, requestId: "r1", threadId: THREAD, assistantMessage: "Hello!" };

  it("200 completed → completed view (replay:false)", () => {
    expect(mapResponse(200, completed)).toMatchObject({ kind: "completed", assistantMessage: "Hello!", threadId: THREAD, replay: false });
  });
  it("200 completed replay:true renders the same content (no duplicate work in UI)", () => {
    const r = mapResponse(200, { ...completed, replay: true });
    expect(r).toMatchObject({ kind: "completed", replay: true, assistantMessage: "Hello!" });
  });
  it("carries clarification / uncertainty / action / memory when present", () => {
    const r = mapResponse(200, {
      ...completed,
      clarification: true,
      uncertainty: { level: "high", notes: "n" },
      action: { status: "approval_required", capabilityId: "portal.propose_internal_task", proposalId: "p1" },
      memory: { status: "needs_confirmation", memoryId: "m1" },
    });
    expect(r).toMatchObject({
      kind: "completed",
      clarification: true,
      uncertainty: { level: "high", notes: "n" },
      action: { status: "approval_required", proposalId: "p1" },
      memory: { status: "needs_confirmation", memoryId: "m1" },
    });
  });
  it("202 processing → processing (no new turn)", () => {
    expect(mapResponse(202, { status: "processing", turnId: "t9" })).toEqual({ kind: "processing" });
  });
  it("409 idempotency_conflict → non-retryable error", () => {
    expect(mapResponse(409, { error: "idempotency_conflict" })).toMatchObject({ kind: "error", code: "idempotency_conflict", retryable: false });
  });
  it("429 rate_limited → retryable + Retry-After seconds", () => {
    const r = mapResponse(429, { error: "rate_limited" }, "37");
    expect(r).toMatchObject({ kind: "error", code: "rate_limited", retryable: true, retryAfterSeconds: 37 });
  });
  it("provider errors map to retryable errors, never a fake success", () => {
    for (const [status, code] of [[502, "provider_error"], [502, "provider_invalid_response"], [503, "provider_unavailable"], [504, "provider_timeout"]] as const) {
      const r = mapResponse(status, { error: code });
      expect(r.kind).toBe("error");
      if (r.kind === "error") expect(r.retryable).toBe(true);
    }
  });
  it("404 not_found → friendly non-retryable", () => {
    expect(mapResponse(404, { error: "not_found" })).toMatchObject({ kind: "error", code: "not_found", retryable: false });
  });
  it("a malformed 200 body is an error, never a fabricated message", () => {
    expect(mapResponse(200, { status: "completed" }).kind).toBe("error"); // no assistantMessage
  });
  it("never leaks raw provider/DB text — only mapped copy", () => {
    const r = mapResponse(500, { error: "internal_error" });
    expect(JSON.stringify(r)).not.toMatch(/stack|postgres|sk-|password/i);
  });
});

describe("errorCopy / constants", () => {
  it("MESSAGE_MAX_CHARS matches the transport cap", () => {
    expect(MESSAGE_MAX_CHARS).toBe(20_000);
  });
  it("unknown codes fall back to a generic retryable message", () => {
    expect(errorCopy("something_new")).toEqual({ message: "Something went wrong — please try again.", retryable: true });
  });
});
