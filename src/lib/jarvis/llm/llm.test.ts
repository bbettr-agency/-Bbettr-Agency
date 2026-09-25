import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isJarvisEnabled, isJarvisIntelligenceEnabled } from "@/lib/flags";
import { getIntelligenceLimits, boundedInt, INTELLIGENCE_LIMIT_DEFAULTS } from "./limits";
import { createLLMProvider, SUPPORTED_PROVIDERS } from "./factory";
import { createMockProvider } from "./mock";
import { LLMProviderError, isRetryableKind, isLLMProviderError, type LLMErrorKind } from "./errors";
import type { LLMCompletionRequest } from "./provider";

const ENV_KEYS = [
  "JARVIS_ENABLED", "JARVIS_INTELLIGENCE_ENABLED", "JARVIS_LLM_PROVIDER", "JARVIS_LLM_MODEL",
  "JARVIS_LLM_HISTORY_TURNS", "JARVIS_LLM_MAX_OUTPUT_TOKENS", "JARVIS_LLM_TIMEOUT_MS",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("feature flag — isJarvisIntelligenceEnabled (fail-closed, requires BOTH)", () => {
  it("absent → disabled", () => { expect(isJarvisIntelligenceEnabled()).toBe(false); });
  it("JARVIS_ENABLED only → disabled", () => { process.env.JARVIS_ENABLED = "true"; expect(isJarvisIntelligenceEnabled()).toBe(false); });
  it("INTELLIGENCE=false → disabled", () => { process.env.JARVIS_ENABLED = "true"; process.env.JARVIS_INTELLIGENCE_ENABLED = "false"; expect(isJarvisIntelligenceEnabled()).toBe(false); });
  it("malformed value ('TRUE') → disabled", () => { process.env.JARVIS_ENABLED = "true"; process.env.JARVIS_INTELLIGENCE_ENABLED = "TRUE"; expect(isJarvisIntelligenceEnabled()).toBe(false); });
  it("INTELLIGENCE=true but JARVIS_ENABLED unset → disabled (requires both)", () => { process.env.JARVIS_INTELLIGENCE_ENABLED = "true"; expect(isJarvisIntelligenceEnabled()).toBe(false); });
  it("both true → enabled", () => { process.env.JARVIS_ENABLED = "true"; process.env.JARVIS_INTELLIGENCE_ENABLED = "true"; expect(isJarvisIntelligenceEnabled()).toBe(true); });
  it("does not change JARVIS_ENABLED semantics", () => { process.env.JARVIS_ENABLED = "true"; expect(isJarvisEnabled()).toBe(true); expect(isJarvisIntelligenceEnabled()).toBe(false); });
});

describe("central limits", () => {
  it("safe defaults with no env", () => {
    expect(getIntelligenceLimits()).toEqual({ historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000, maxProviderCallsPerTurn: 1, maxTransientRetries: 1 });
    expect(INTELLIGENCE_LIMIT_DEFAULTS).toEqual({ historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000 });
  });
  it("valid bounded override", () => { process.env.JARVIS_LLM_MAX_OUTPUT_TOKENS = "2000"; expect(getIntelligenceLimits().maxOutputTokens).toBe(2000); });
  it("zero/negative/malformed → default", () => {
    expect(boundedInt("0", 1200, 1, 4000)).toBe(1200);
    expect(boundedInt("-5", 1200, 1, 4000)).toBe(1200);
    expect(boundedInt("abc", 1200, 1, 4000)).toBe(1200);
    expect(boundedInt("", 1200, 1, 4000)).toBe(1200);
    expect(boundedInt("1.5", 1200, 1, 4000)).toBe(1200);
    expect(boundedInt(undefined, 1200, 1, 4000)).toBe(1200);
  });
  it("absurdly high value is CLAMPED to hard max", () => { process.env.JARVIS_LLM_MAX_OUTPUT_TOKENS = "999999"; expect(getIntelligenceLimits().maxOutputTokens).toBe(4000); });
  it("too-low timeout is clamped to hard min", () => { process.env.JARVIS_LLM_TIMEOUT_MS = "500"; expect(getIntelligenceLimits().timeoutMs).toBe(1000); });
  it("one-call / one-retry policy constants are fixed", () => { const l = getIntelligenceLimits(); expect(l.maxProviderCallsPerTurn).toBe(1); expect(l.maxTransientRetries).toBe(1); });
});

describe("factory — fail-closed, no implicit provider", () => {
  it("missing provider → configuration error (not retryable)", () => {
    try { createLLMProvider(); expect.unreachable(); } catch (e) { expect(isLLMProviderError(e)).toBe(true); expect((e as LLMProviderError).kind).toBe("configuration"); expect((e as LLMProviderError).retryable).toBe(false); }
  });
  it("provider set but no model → configuration error", () => {
    process.env.JARVIS_LLM_PROVIDER = "anthropic";
    expect(() => createLLMProvider()).toThrow(/JARVIS_LLM_MODEL/);
  });
  it("unsupported provider → configuration error, no fallback", () => {
    process.env.JARVIS_LLM_PROVIDER = "openai"; process.env.JARVIS_LLM_MODEL = "x";
    expect(() => createLLMProvider()).toThrow(/unsupported provider/);
  });
  it("anthropic selected → still fails closed in Slice B (no real call, not the mock)", () => {
    process.env.JARVIS_LLM_PROVIDER = "anthropic"; process.env.JARVIS_LLM_MODEL = "some-model";
    expect(() => createLLMProvider()).toThrow(/not implemented until Slice E/);
  });
  it("no configuration ever yields the mock as a production default", () => {
    // Every reachable Slice-B config throws; the factory never returns a provider.
    for (const cfg of [{}, { JARVIS_LLM_PROVIDER: "anthropic", JARVIS_LLM_MODEL: "m" }, { JARVIS_LLM_PROVIDER: "mock", JARVIS_LLM_MODEL: "m" }]) {
      for (const k of ["JARVIS_LLM_PROVIDER", "JARVIS_LLM_MODEL"]) delete process.env[k];
      Object.assign(process.env, cfg);
      expect(() => createLLMProvider()).toThrow();
    }
    expect(SUPPORTED_PROVIDERS).not.toContain("mock");
  });
});

const req = (over: Partial<LLMCompletionRequest> = {}): LLMCompletionRequest => ({
  system: "you are jarvis", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 1200, timeoutMs: 30_000, ...over,
});

describe("mock provider", () => {
  it("deterministic completion + usage", async () => {
    const p = createMockProvider({ text: "hello", usage: { inputTokens: 3, outputTokens: 2 }, finishReason: "stop" });
    const r = await p.complete(req());
    expect(r).toMatchObject({ text: "hello", providerId: "mock", model: "mock-model", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 2 } });
  });
  it("can return arbitrary/malformed text (for later parser tests)", async () => {
    const p = createMockProvider({ text: "{ not valid json <<" });
    expect((await p.complete(req())).text).toBe("{ not valid json <<");
  });
  it("simulates a retryable failure", async () => {
    const p = createMockProvider({ failWith: "provider_5xx" });
    await expect(p.complete(req())).rejects.toMatchObject({ kind: "provider_5xx", retryable: true });
  });
  it("simulates a non-retryable failure", async () => {
    const p = createMockProvider({ failWith: "provider_4xx" });
    await expect(p.complete(req())).rejects.toMatchObject({ kind: "provider_4xx", retryable: false });
  });
  it("respects cancellation/timeout via AbortSignal", async () => {
    const p = createMockProvider({ delayMs: 1000 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await expect(p.complete(req({ signal: ac.signal }))).rejects.toMatchObject({ kind: "timeout" });
  });
  it("rejects immediately if already aborted", async () => {
    const p = createMockProvider({ delayMs: 1000 });
    const ac = new AbortController(); ac.abort();
    await expect(p.complete(req({ signal: ac.signal }))).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("error model", () => {
  it("retryable classification", () => {
    const retry: LLMErrorKind[] = ["timeout", "rate_limit", "provider_5xx", "unavailable"];
    const noRetry: LLMErrorKind[] = ["configuration", "provider_4xx", "invalid_response"];
    for (const k of retry) expect(isRetryableKind(k)).toBe(true);
    for (const k of noRetry) expect(isRetryableKind(k)).toBe(false);
  });
  it("message is safe and carries no secret/raw body", () => {
    const e = new LLMProviderError("provider_5xx", { safeDetail: "upstream 503", providerId: "mock" });
    expect(e.message).toBe("llm_provider_error:provider_5xx (upstream 503)");
    expect(e.retryable).toBe(true);
    expect(e.message).not.toMatch(/sk-|api[_-]?key|authorization|bearer/i);
  });
});

describe("provider contract shape (no authority/DB coupling)", () => {
  it("a bounded request needs only system/messages/limits — no JarvisContext/DB/grants", async () => {
    // If the contract required an authority object, this would not type-check/compile.
    const r = await createMockProvider({ text: "ok" }).complete({
      system: "s", messages: [{ role: "user", content: "q" }], maxOutputTokens: 100, timeoutMs: 5000,
    });
    expect(r.text).toBe("ok");
  });
});
