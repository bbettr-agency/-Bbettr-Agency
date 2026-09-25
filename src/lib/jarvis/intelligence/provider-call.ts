import "server-only";

import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult } from "@/lib/jarvis/llm/provider";
import { LLMProviderError, isLLMProviderError } from "@/lib/jarvis/llm/errors";
import type { IntelligenceLimits } from "@/lib/jarvis/llm/limits";

/**
 * Jarvis Intelligence — trusted provider-call wrapper (Slice C, server-only).
 *
 * OVERALL-TURN DEADLINE (authority note in Slice-B provider.ts): the orchestrator
 * owns ONE wall-clock budget for the entire provider-call sequence — the initial
 * call AND any retry share it. We enforce it two ways that agree in production:
 *   • a single AbortController with ONE timer set for the full budget; its signal
 *     is wired into every request and aborts an in-flight call at the deadline;
 *   • a computed REMAINING budget: each attempt is passed only `deadline - now`
 *     as its `timeoutMs`, and we refuse to start an attempt once the budget is
 *     spent. So attempt 2 never gets a fresh full timeout, and initial + retry can
 *     never exceed the overall budget beyond negligible scheduling overhead.
 * The timer is ALWAYS cleared in `finally` (no dangling timers).
 *
 * RETRY (fixed Slice-B policy): exactly ONE provider call per normal turn plus at
 * most ONE transient retry. We retry ONLY a retryable LLMProviderError, and NEVER
 * once the deadline has fired / the signal is aborted / the remaining budget is
 * ≤ 0. Non-retryable kinds and unknown throwables never retry. No backoff is
 * implemented in Slice C; if one is ever added it MUST consume this same budget.
 */

export type ProviderCallInput = Pick<LLMCompletionRequest, "system" | "messages">;

export interface ProviderCallOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export async function callProviderWithPolicy(
  provider: LLMProvider,
  input: ProviderCallInput,
  limits: IntelligenceLimits,
  opts: ProviderCallOptions = {}
): Promise<LLMCompletionResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const deadline = start + limits.timeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    let attempt = 0;
    for (;;) {
      attempt += 1;

      // Refuse to start an attempt with no budget left (or an already-fired abort).
      const remaining = deadline - now();
      if (remaining <= 0 || controller.signal.aborted) {
        throw new LLMProviderError("timeout", { safeDetail: "overall_deadline_exhausted" });
      }

      const request: LLMCompletionRequest = {
        system: input.system,
        messages: input.messages,
        maxOutputTokens: limits.maxOutputTokens,
        timeoutMs: remaining, // ONLY the remaining overall budget — never a fresh full timeout
        signal: controller.signal,
      };

      try {
        return await provider.complete(request);
      } catch (e) {
        const err = isLLMProviderError(e)
          ? e
          : new LLMProviderError("unavailable", { safeDetail: "non_provider_error", retryable: false, cause: e });
        const mayRetry =
          err.retryable &&
          attempt <= limits.maxTransientRetries && // 1 initial + up to maxTransientRetries retries
          !controller.signal.aborted && // never retry once the deadline fired
          deadline - now() > 0; // ...or once the budget is spent
        if (!mayRetry) throw err;
        // else: loop and retry under the SAME deadline/signal with the remaining budget.
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
