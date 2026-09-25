import { describe, it, expect, vi } from "vitest";
import { callProviderWithPolicy, type ProviderCallInput } from "./provider-call";
import { createMockProvider } from "@/lib/jarvis/llm/mock";
import { LLMProviderError } from "@/lib/jarvis/llm/errors";
import type { IntelligenceLimits } from "@/lib/jarvis/llm/limits";
import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult } from "@/lib/jarvis/llm/provider";

const INPUT: ProviderCallInput = { system: "sys", messages: [{ role: "user", content: "hi" }] };

function limits(over: Partial<IntelligenceLimits> = {}): IntelligenceLimits {
  return { historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000, maxProviderCallsPerTurn: 1, maxTransientRetries: 1, ...over };
}

const RESULT: LLMCompletionResult = {
  text: "ok",
  providerId: "mock",
  model: "mock-model",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 1,
};

/** A provider whose complete() runs a scripted sequence of throw/return per call. */
function scriptedProvider(steps: Array<"5xx" | "429" | "config" | "4xx" | "boom" | "ok">) {
  let i = 0;
  const reqs: LLMCompletionRequest[] = [];
  const provider: LLMProvider = {
    id: "scripted",
    model: "m",
    complete: vi.fn(async (req: LLMCompletionRequest) => {
      reqs.push(req);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      switch (step) {
        case "5xx":
          throw new LLMProviderError("provider_5xx");
        case "429":
          throw new LLMProviderError("rate_limit");
        case "config":
          throw new LLMProviderError("configuration");
        case "4xx":
          throw new LLMProviderError("provider_4xx");
        case "boom":
          throw new Error("unexpected non-provider error");
        case "ok":
        default:
          return RESULT;
      }
    }),
  };
  return { provider, calls: () => i, reqs };
}

/** Deterministic clock: returns each scripted value in turn, then holds the last. */
function fakeNow(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("callProviderWithPolicy — success + limits", () => {
  it("returns the adapter result and passes the bounded budget into the request", async () => {
    const provider = createMockProvider({ text: "hello", usage: { inputTokens: 3, outputTokens: 4 } });
    const spy = vi.spyOn(provider, "complete");
    const r = await callProviderWithPolicy(provider, INPUT, limits({ maxOutputTokens: 777, timeoutMs: 5000 }), { now: () => 0 });
    expect(r.text).toBe("hello");
    const req = spy.mock.calls[0][0];
    expect(req.maxOutputTokens).toBe(777);
    expect(req.timeoutMs).toBe(5000); // full budget on the first (only) attempt
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("callProviderWithPolicy — retry policy (1 call + ≤1 transient retry)", () => {
  it("retries ONCE on a retryable error, then succeeds", async () => {
    const { provider, calls } = scriptedProvider(["5xx", "ok"]);
    const r = await callProviderWithPolicy(provider, INPUT, limits());
    expect(r.text).toBe("ok");
    expect(calls()).toBe(2);
  });

  it("gives up after exactly one retry when the retryable error persists", async () => {
    const { provider, calls } = scriptedProvider(["429", "429", "429"]);
    await expect(callProviderWithPolicy(provider, INPUT, limits())).rejects.toBeInstanceOf(LLMProviderError);
    expect(calls()).toBe(2); // initial + 1 retry only
  });

  it("does NOT retry a non-retryable configuration error", async () => {
    const { provider, calls } = scriptedProvider(["config", "ok"]);
    await expect(callProviderWithPolicy(provider, INPUT, limits())).rejects.toMatchObject({ kind: "configuration" });
    expect(calls()).toBe(1);
  });

  it("does NOT retry a non-retryable provider_4xx", async () => {
    const { provider, calls } = scriptedProvider(["4xx", "ok"]);
    await expect(callProviderWithPolicy(provider, INPUT, limits())).rejects.toMatchObject({ kind: "provider_4xx" });
    expect(calls()).toBe(1);
  });

  it("does NOT retry an unknown (non-provider) throwable; wraps it safely", async () => {
    const { provider, calls } = scriptedProvider(["boom", "ok"]);
    await expect(callProviderWithPolicy(provider, INPUT, limits())).rejects.toMatchObject({ kind: "unavailable", retryable: false });
    expect(calls()).toBe(1);
  });
});

describe("callProviderWithPolicy — orchestrator-owned deadline", () => {
  it("aborts a slow call at the overall-turn deadline and surfaces a timeout", async () => {
    // delay far exceeds the 1s deadline; the mock honors the injected signal.
    const provider = createMockProvider({ delayMs: 10_000 });
    await expect(callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("does not retry once the deadline has already fired", async () => {
    // The single controller is shared across attempts; an abort stops further tries.
    const provider = createMockProvider({ delayMs: 10_000 });
    const spy = vi.spyOn(provider, "complete");
    await expect(callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }))).rejects.toMatchObject({ kind: "timeout" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("callProviderWithPolicy — overall (not per-attempt) budget", () => {
  it("gives the RETRY only the REMAINING budget, never a fresh full timeout", async () => {
    const { provider, reqs } = scriptedProvider(["5xx", "ok"]);
    // deadline = 0 + 1000. Clock reads: start=0, attempt1 remaining=0, mayRetry=400, attempt2 remaining=400.
    const now = fakeNow([0, 0, 400, 400]);
    const r = await callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }), { now });
    expect(r.text).toBe("ok");
    expect(reqs[0].timeoutMs).toBe(1000); // initial: full budget
    expect(reqs[1].timeoutMs).toBe(600); // retry: only the remaining 600ms (1000 - 400)
    expect(reqs[1].timeoutMs).toBeLessThan(reqs[0].timeoutMs);
  });

  it("does NOT start a retry after the deadline has passed (surfaces the original error)", async () => {
    const { provider, calls } = scriptedProvider(["5xx", "ok"]);
    // After attempt 1 fails, the clock has jumped past the deadline (1001 > 1000).
    const now = fakeNow([0, 0, 1001]);
    await expect(callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }), { now })).rejects.toMatchObject({ kind: "provider_5xx" });
    expect(calls()).toBe(1); // no second attempt
  });

  it("refuses to even START a call when the budget is already spent (no provider call)", async () => {
    const { provider, calls } = scriptedProvider(["ok"]);
    const now = fakeNow([0, 2000]); // remaining = 1000 - 2000 < 0 before the first attempt
    await expect(callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }), { now })).rejects.toMatchObject({ kind: "timeout" });
    expect(calls()).toBe(0);
  });

  it("uses exactly ONE controller/timer and always clears it (no dangling timers)", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { provider } = scriptedProvider(["5xx", "ok"]);
    await callProviderWithPolicy(provider, INPUT, limits({ timeoutMs: 1000 }), { now: fakeNow([0, 0, 100, 100]) });
    // one deadline timer created for the whole sequence, and it is cleared.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
