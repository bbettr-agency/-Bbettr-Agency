import { describe, it, expect } from "vitest";
import { parseAssistantResponse } from "./response-contract";

/**
 * MODEL OUTPUT IS UNTRUSTED. These prove the contract parses/validates/bounds and
 * NEVER trusts model-claimed metadata or executes anything.
 */

const ok = (o: unknown) => JSON.stringify(o);

describe("parseAssistantResponse — happy path", () => {
  it("accepts the minimal valid object", () => {
    const r = parseAssistantResponse(ok({ assistant_message: "Hello" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assistantMessage).toBe("Hello");
  });

  it("maps snake_case contract to camelCase validated shape", () => {
    const r = parseAssistantResponse(
      ok({
        assistant_message: "Done",
        reasoning_summary: "short user-safe summary",
        uncertainty: { level: "medium", notes: "n" },
        proposed_intent: { capability_id: "task.create", args: { title: "x" }, rationale: "why" },
        memory_candidate: { scope: "client", category: "client_knowledge", claim: "c", body: "b" },
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reasoningSummary).toBe("short user-safe summary");
    expect(r.value.uncertainty).toEqual({ level: "medium", notes: "n" });
    expect(r.value.proposedIntent).toEqual({ capabilityId: "task.create", args: { title: "x" }, rationale: "why" });
    expect(r.value.memoryCandidate).toEqual({ scope: "client", category: "client_knowledge", claim: "c", body: "b" });
  });
});

describe("parseAssistantResponse — rejects malformed / unsafe", () => {
  it("rejects non-JSON", () => {
    expect(parseAssistantResponse("I am not JSON at all")).toEqual({ ok: false, reason: "not_json" });
  });
  it("rejects empty string", () => {
    expect(parseAssistantResponse("")).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects oversized raw text before parsing", () => {
    const big = "x".repeat(60_001);
    expect(parseAssistantResponse(big)).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects missing assistant_message", () => {
    expect(parseAssistantResponse(ok({ reasoning_summary: "x" }))).toEqual({ ok: false, reason: "schema" });
  });
  it("rejects empty assistant_message", () => {
    expect(parseAssistantResponse(ok({ assistant_message: "" }))).toEqual({ ok: false, reason: "schema" });
  });
  it("rejects an over-long assistant_message", () => {
    expect(parseAssistantResponse(ok({ assistant_message: "x".repeat(8001) }))).toEqual({ ok: false, reason: "schema" });
  });
  it("rejects an unknown uncertainty level", () => {
    expect(parseAssistantResponse(ok({ assistant_message: "h", uncertainty: { level: "extreme" } }))).toEqual({
      ok: false,
      reason: "schema",
    });
  });
  it("rejects an unknown memory category (allowlist only)", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", memory_candidate: { scope: "agency", category: "made_up", claim: "c" } }))
    ).toEqual({ ok: false, reason: "schema" });
  });
  it("rejects a memory scope outside the enum", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", memory_candidate: { scope: "workspace", category: "decision", claim: "c" } }))
    ).toEqual({ ok: false, reason: "schema" });
  });
});

describe("parseAssistantResponse — STRICT: unknown keys fail closed", () => {
  it("REJECTS model-claimed provider/model/usage/provenance at the root (never trusts, never strips)", () => {
    expect(parseAssistantResponse(ok({ assistant_message: "done", provider: "anthropic" }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", model: "claude-omniscient" }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", usage: { inputTokens: 999999 } }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", provenance: { fabricated: true } }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", finish_reason: "stop" }))).toEqual({ ok: false, reason: "schema" });
  });

  it("REJECTS an authority/scope field smuggled at the root", () => {
    expect(parseAssistantResponse(ok({ assistant_message: "done", execute: true }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", workspace_id: "w1" }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", run_sql: "DROP TABLE clients;" }))).toEqual({ ok: false, reason: "schema" });
    expect(parseAssistantResponse(ok({ assistant_message: "done", grant: "admin" }))).toEqual({ ok: false, reason: "schema" });
  });

  it("REJECTS an unknown key inside the proposed_intent envelope (e.g. approved/executed)", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "done", proposed_intent: { capability_id: "x", args: {}, approved: true } }))
    ).toEqual({ ok: false, reason: "schema" });
    expect(
      parseAssistantResponse(ok({ assistant_message: "done", proposed_intent: { capability_id: "x", args: {}, executed: true } }))
    ).toEqual({ ok: false, reason: "schema" });
  });

  it("KEEPS proposed_intent.args open (capability-specific opaque data is allowed)", () => {
    const r = parseAssistantResponse(
      ok({ assistant_message: "done", proposed_intent: { capability_id: "task.create", args: { title: "x", nested: { anything: [1, 2, 3] } } } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.proposedIntent?.args).toEqual({ title: "x", nested: { anything: [1, 2, 3] } });
  });

  it("REJECTS an unknown key inside the memory_candidate envelope (e.g. client_id)", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "done", memory_candidate: { scope: "client", category: "client_knowledge", claim: "c", client_id: "leak" } }))
    ).toEqual({ ok: false, reason: "schema" });
    expect(
      parseAssistantResponse(ok({ assistant_message: "done", memory_candidate: { scope: "client", category: "client_knowledge", claim: "c", state: "confirmed" } }))
    ).toEqual({ ok: false, reason: "schema" });
  });

  it("REJECTS an unknown key inside the uncertainty envelope", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "done", uncertainty: { level: "low", confidence: 0.9 } }))
    ).toEqual({ ok: false, reason: "schema" });
  });

  it("accepts at most ONE proposed_intent / memory_candidate (objects, not arrays)", () => {
    // An array where an object is required is a schema violation.
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", proposed_intent: [{ capability_id: "a", args: {} }] }))
    ).toEqual({ ok: false, reason: "schema" });
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", memory_candidate: [{ scope: "agency", category: "decision", claim: "c" }] }))
    ).toEqual({ ok: false, reason: "schema" });
  });

  it("bounds proposed_intent.capability_id and claim sizes", () => {
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", proposed_intent: { capability_id: "x".repeat(121), args: {} } }))
    ).toEqual({ ok: false, reason: "schema" });
    expect(
      parseAssistantResponse(ok({ assistant_message: "h", memory_candidate: { scope: "agency", category: "decision", claim: "x".repeat(2001) } }))
    ).toEqual({ ok: false, reason: "schema" });
  });
});
