import "server-only";

import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult, LLMUsage } from "./provider";
import { LLMProviderError, type LLMErrorKind } from "./errors";

/**
 * Jarvis Intelligence — deterministic MOCK provider (TEST-ONLY, Slice B).
 *
 * Lets Slices C/D exercise the orchestration boundary with no network, no API
 * key, no SDK, no cost, and no nondeterminism. It is created ONLY by explicit
 * calls to `createMockProvider(...)`; the production `createLLMProvider()` factory
 * never imports or returns it, so it can never be an accidental production
 * fallback. `server-only` keeps it out of any client bundle.
 */
export interface MockProviderConfig {
  id?: string;
  model?: string;
  /** Deterministic completion text (may be arbitrary/malformed for parser tests). */
  text?: string;
  usage?: LLMUsage;
  finishReason?: string | null;
  latencyMs?: number;
  /** If set, complete() throws an LLMProviderError of this kind (failure simulation). */
  failWith?: LLMErrorKind;
  /** If >0, waits this long before resolving — combine with request.signal to test timeout. */
  delayMs?: number;
}

export function createMockProvider(cfg: MockProviderConfig = {}): LLMProvider {
  const id = cfg.id ?? "mock";
  const model = cfg.model ?? "mock-model";

  return {
    id,
    model,
    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
      if (cfg.failWith) {
        throw new LLMProviderError(cfg.failWith, { providerId: id, safeDetail: "mock failure" });
      }

      // Timeout/cancellation simulation: resolve after delayMs unless aborted first.
      if (request.signal?.aborted) {
        throw new LLMProviderError("timeout", { providerId: id, safeDetail: "aborted before start" });
      }
      if (cfg.delayMs && cfg.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, cfg.delayMs);
          request.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(new LLMProviderError("timeout", { providerId: id, safeDetail: "aborted" }));
            },
            { once: true }
          );
        });
      }

      return {
        text: cfg.text ?? "mock completion",
        providerId: id,
        model,
        finishReason: cfg.finishReason ?? "stop",
        usage: cfg.usage ?? { inputTokens: 10, outputTokens: 5 },
        latencyMs: cfg.latencyMs ?? 1,
      };
    },
  };
}
