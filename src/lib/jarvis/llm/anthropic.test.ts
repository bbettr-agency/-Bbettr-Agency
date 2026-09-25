import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createAnthropicProvider,
  ANTHROPIC_PROVIDER_ID,
  type AnthropicClientLike,
  type AnthropicMessageCreateBody,
  type AnthropicMessageLike,
} from "./anthropic";
import { LLMProviderError, isLLMProviderError, type LLMErrorKind } from "./errors";
import type { LLMCompletionRequest } from "./provider";

/**
 * Adapter tests. ZERO network, no API key: a fake client is injected via the
 * `createClient` seam. These prove the mapping and the security/boundary rules.
 */

const req = (over: Partial<LLMCompletionRequest> = {}): LLMCompletionRequest => ({
  system: "you are jarvis",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 1200,
  timeoutMs: 30_000,
  ...over,
});

function okMessage(over: Partial<AnthropicMessageLike> = {}): AnthropicMessageLike {
  return {
    content: [{ type: "text", text: '{"assistant_message":"hello"}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 7 },
    model: "claude-sonnet-5",
    ...over,
  };
}

/** Build a provider with a fake client; capture constructor opts + create calls. */
function withFake(opts: {
  respond?: (body: AnthropicMessageCreateBody, options?: { signal?: AbortSignal; maxRetries?: number }) => Promise<AnthropicMessageLike>;
  model?: string;
  apiKey?: string;
}) {
  const seen = {
    clientOpts: undefined as { apiKey: string; maxRetries: number } | undefined,
    body: undefined as AnthropicMessageCreateBody | undefined,
    options: undefined as { signal?: AbortSignal; maxRetries?: number } | undefined,
    calls: 0,
  };
  const create = vi.fn(async (body: AnthropicMessageCreateBody, options?: { signal?: AbortSignal; maxRetries?: number }) => {
    seen.body = body;
    seen.options = options;
    seen.calls += 1;
    return opts.respond ? opts.respond(body, options) : okMessage();
  });
  const client: AnthropicClientLike = { messages: { create } };
  const provider = createAnthropicProvider({
    apiKey: opts.apiKey ?? "test-key-not-real",
    model: opts.model ?? "claude-sonnet-5",
    createClient: (o) => {
      seen.clientOpts = o;
      return client;
    },
  });
  return { provider, seen };
}

describe("anthropic adapter — identity + request mapping", () => {
  it("provider id is 'anthropic' and configured model is preserved", () => {
    const { provider } = withFake({ model: "claude-sonnet-5" });
    expect(provider.id).toBe(ANTHROPIC_PROVIDER_ID);
    expect(provider.model).toBe("claude-sonnet-5");
  });

  it("constructs the SDK client with maxRetries: 0 (Jarvis owns retry)", () => {
    const { seen } = withFake({});
    expect(seen.clientOpts?.maxRetries).toBe(0);
  });

  it("maps system → top-level system, and does NOT insert a system-role message", async () => {
    const { provider, seen } = withFake({});
    await provider.complete(req({ system: "SYS", messages: [{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }] }));
    expect(seen.body?.system).toBe("SYS");
    expect(seen.body?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
    expect(seen.body?.messages.some((m) => (m as { role: string }).role === "system")).toBe(false);
  });

  it("maps maxOutputTokens → max_tokens and passes the supplied AbortSignal + maxRetries:0 per request", async () => {
    const controller = new AbortController();
    const { provider, seen } = withFake({});
    await provider.complete(req({ maxOutputTokens: 999, signal: controller.signal }));
    expect(seen.body?.max_tokens).toBe(999);
    expect(seen.options?.signal).toBe(controller.signal);
    expect(seen.options?.maxRetries).toBe(0);
  });

  it("DISABLES extended thinking so max_tokens is reserved for the JSON contract", async () => {
    const { provider, seen } = withFake({});
    await provider.complete(req());
    expect(seen.body?.thinking).toEqual({ type: "disabled" });
  });

  it("calls the provider exactly once (no adapter/SDK retry loop)", async () => {
    const { provider, seen } = withFake({});
    await provider.complete(req());
    expect(seen.calls).toBe(1);
  });
});

describe("anthropic adapter — response extraction", () => {
  it("extracts a single text block", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ content: [{ type: "text", text: "ABC" }] }) });
    const r = await provider.complete(req());
    expect(r.text).toBe("ABC");
  });

  it("concatenates multiple text blocks deterministically and ignores non-text blocks", async () => {
    const { provider } = withFake({
      respond: async () =>
        okMessage({
          content: [
            { type: "text", text: '{"assistant_' },
            { type: "thinking", thinking: "SECRET REASONING" } as never,
            { type: "text", text: 'message":"ok"}' },
          ],
        }),
    });
    const r = await provider.complete(req());
    expect(r.text).toBe('{"assistant_message":"ok"}'); // thinking block not included
    expect(r.text).not.toContain("SECRET");
  });

  it("no usable text block → invalid_response", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ content: [{ type: "thinking", thinking: "x" } as never] }) });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("empty content array → invalid_response (no stringifying of the raw object)", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ content: [] }) });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("anthropic adapter — trusted metadata (never model-authored)", () => {
  it("providerId/model come from the adapter; usage from the trusted response", async () => {
    const { provider } = withFake({
      model: "claude-sonnet-5",
      respond: async () => okMessage({ usage: { input_tokens: 42, output_tokens: 8 }, model: "something-else" }),
    });
    const r = await provider.complete(req());
    expect(r.providerId).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-5"); // configured identity, not response.model
    expect(r.usage).toEqual({ inputTokens: 42, outputTokens: 8 });
  });

  it("model-authored JSON claiming provider/model/usage cannot override trusted values", async () => {
    const lyingText = JSON.stringify({ assistant_message: "ok", provider: "evil", model: "omni", usage: { inputTokens: 9e9 } });
    const { provider } = withFake({ respond: async () => okMessage({ content: [{ type: "text", text: lyingText }], usage: { input_tokens: 5, output_tokens: 6 } }) });
    const r = await provider.complete(req());
    expect(r.providerId).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
    expect(r.text).toBe(lyingText); // returned verbatim as text; Slice C parses/strips it
  });

  it("absent/malformed usage → null token fields (never invented)", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ usage: null }) });
    const r = await provider.complete(req());
    expect(r.usage).toEqual({ inputTokens: null, outputTokens: null });
  });
});

describe("anthropic adapter — finish reason mapping", () => {
  it.each([
    ["end_turn", "stop"],
    ["max_tokens", "length"],
    ["stop_sequence", "stop_sequence"],
    ["tool_use", "tool_use"],
    ["pause_turn", "pause_turn"],
    ["refusal", "refusal"],
    ["some_future_reason", "some_future_reason"],
  ])("maps stop_reason %s → %s (unknown passes through, never throws)", async (stop, expected) => {
    const { provider } = withFake({ respond: async () => okMessage({ stop_reason: stop }) });
    const r = await provider.complete(req());
    expect(r.finishReason).toBe(expected);
  });

  it("null stop_reason → null", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ stop_reason: null }) });
    const r = await provider.complete(req());
    expect(r.finishReason).toBeNull();
  });

  it("a refusal (HTTP 200, stop_reason=refusal, non-JSON text) is passed THROUGH as text, not thrown", async () => {
    // The adapter does not fabricate success/failure from the stop reason; it returns
    // the refusal prose as text with finishReason "refusal". Strict Slice-C validation
    // is the gate that turns non-JSON refusal text into a safe failure (see orchestrator tests).
    const { provider } = withFake({
      respond: async () => okMessage({ content: [{ type: "text", text: "I can't help with that." }], stop_reason: "refusal" }),
    });
    const r = await provider.complete(req());
    expect(r.finishReason).toBe("refusal");
    expect(r.text).toBe("I can't help with that.");
  });

  it("a tool_use stop with NO text block (Jarvis sends no tools) → invalid_response", async () => {
    const { provider } = withFake({ respond: async () => okMessage({ content: [], stop_reason: "tool_use" }) });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("anthropic adapter — error mapping (typed status, existing taxonomy)", () => {
  const httpError = (status: number) => Object.assign(new Error(`http ${status}`), { status });

  it.each<[number, LLMErrorKind, boolean]>([
    [408, "timeout", true], // request timeout — provider-documented transient, stays retryable
    [409, "unavailable", true], // conflict — provider-documented transient, stays retryable
    [429, "rate_limit", true],
    [500, "provider_5xx", true],
    [503, "provider_5xx", true],
    [529, "provider_5xx", true], // overload → retryable existing kind (no new 'overloaded' kind)
    [401, "configuration", false], // invalid/revoked credential → non-retryable
    [400, "provider_4xx", false],
    [403, "provider_4xx", false],
    [404, "provider_4xx", false],
    [413, "provider_4xx", false],
  ])("HTTP %i → %s (retryable=%s)", async (status, kind, retryable) => {
    const { provider } = withFake({ respond: async () => { throw httpError(status); } });
    try {
      await provider.complete(req());
      expect.unreachable();
    } catch (e) {
      const err = e as LLMProviderError;
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(retryable);
    }
  });

  it("aborted signal → timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider } = withFake({ respond: async () => { throw Object.assign(new Error("aborted"), { name: "APIUserAbortError" }); } });
    await expect(provider.complete(req({ signal: controller.signal }))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("APIUserAbortError (without pre-aborted signal) → timeout", async () => {
    const { provider } = withFake({ respond: async () => { throw Object.assign(new Error("user abort"), { name: "APIUserAbortError" }); } });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "timeout" });
  });

  it("APIConnectionTimeoutError → timeout", async () => {
    const { provider } = withFake({ respond: async () => { throw Object.assign(new Error("conn timeout"), { name: "APIConnectionTimeoutError" }); } });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "timeout" });
  });

  it("APIConnectionError (network) → unavailable", async () => {
    const { provider } = withFake({ respond: async () => { throw Object.assign(new Error("network"), { name: "APIConnectionError" }); } });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("unknown throwable → unavailable (conservative)", async () => {
    const { provider } = withFake({ respond: async () => { throw new Error("mystery"); } });
    await expect(provider.complete(req())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("all mapped errors are LLMProviderError instances (no raw SDK error leaks upward)", async () => {
    const { provider } = withFake({ respond: async () => { throw Object.assign(new Error("x"), { status: 500 }); } });
    await provider.complete(req()).catch((e) => expect(isLLMProviderError(e)).toBe(true));
  });
});

describe("anthropic adapter — security (no key/secret leakage)", () => {
  it("the API key never appears in a successful result", async () => {
    const KEY = "super-secret-key-value-xyz";
    const { provider } = withFake({ apiKey: KEY });
    const r = await provider.complete(req());
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("the API key never appears in a mapped error's message/detail", async () => {
    const KEY = "super-secret-key-value-xyz";
    const { provider } = withFake({ apiKey: KEY, respond: async () => { throw Object.assign(new Error(`boom ${KEY}`), { status: 500 }); } });
    try {
      await provider.complete(req());
      expect.unreachable();
    } catch (e) {
      const err = e as LLMProviderError;
      expect(err.message).not.toContain(KEY);
      expect(err.safeDetail ?? "").not.toContain(KEY);
    }
  });

  it("a 401 (auth error) is non-retryable and leaks neither the key nor the provider body", async () => {
    const KEY = "super-secret-key-value-xyz";
    // Simulate an SDK auth error whose raw body/message embeds the key.
    const { provider } = withFake({ apiKey: KEY, respond: async () => { throw Object.assign(new Error(`invalid x-api-key ${KEY}`), { status: 401, error: { message: `bad key ${KEY}` } }); } });
    try {
      await provider.complete(req());
      expect.unreachable();
    } catch (e) {
      const err = e as LLMProviderError;
      expect(err.kind).toBe("configuration");
      expect(err.retryable).toBe(false);
      expect(err.message).not.toContain(KEY);
      expect(err.safeDetail ?? "").not.toContain(KEY);
      expect(err.safeDetail).toBe("http_401"); // safe label only
    }
  });

  it("construction with a missing key/model fails closed", () => {
    expect(() => createAnthropicProvider({ apiKey: "", model: "m" })).toThrow(LLMProviderError);
    expect(() => createAnthropicProvider({ apiKey: "k", model: "" })).toThrow(LLMProviderError);
  });
});

describe("anthropic adapter — source hygiene (Slice-E scope lock)", () => {
  const src = readFileSync("src/lib/jarvis/llm/anthropic.ts", "utf8");
  // Scan CODE only — strip block + line comments so doc-comment prose ("never
  // dangerouslyAllowBrowser", "hidden thinking") doesn't trip the checks.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").toLowerCase();
  it("is server-only", () => {
    expect(src).toMatch(/^import "server-only";/m);
  });
  it("never uses dangerouslyAllowBrowser", () => {
    expect(code).not.toContain("dangerouslyallowbrowser");
  });
  it("does not stream", () => {
    expect(code).not.toMatch(/\.stream\s*\(/);
  });
  it("uses no beta APIs / tools / web search / sampling tuning in code", () => {
    for (const banned of ["client.beta", "betas:", "tools:", "tool_choice", "web_search", "web_fetch", "temperature", "top_p", "top_k", "cache_control"]) {
      expect(code).not.toContain(banned);
    }
  });
  it("does not enable manual/extended thinking, effort, or budget_tokens (thinking is DISABLED)", () => {
    expect(code).not.toContain("budget_tokens");
    expect(code).not.toContain("effort");
    expect(code).not.toContain('type: "enabled"');
    expect(code).not.toContain('type: "adaptive"');
    expect(code).toContain('thinking: { type: "disabled" }'); // positive: thinking is turned off
  });
  it("uses the non-beta messages.create path", () => {
    expect(src).toContain("client.messages.create");
  });
});
