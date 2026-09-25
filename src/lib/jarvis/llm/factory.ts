import "server-only";

import type { LLMProvider } from "./provider";
import { LLMProviderError } from "./errors";
import { createAnthropicProvider } from "./anthropic";

/**
 * Jarvis Intelligence — provider factory (server-only). FAIL-CLOSED.
 *
 * Selects a provider from configuration ONLY. It never:
 *   • silently falls back to a real provider,
 *   • silently chooses Anthropic (the provider must be named),
 *   • infers a default model (the model must be configured),
 *   • returns the test mock (the mock is not imported here and is never reachable
 *     through the factory — see mock.ts, which is test-only).
 * Slice E wires the real Anthropic adapter, constructed only when the provider is
 * named, a model is configured, AND ANTHROPIC_API_KEY is present. A present API
 * key does NOT enable Intelligence — that stays gated by the feature flags.
 */
export const SUPPORTED_PROVIDERS = ["anthropic"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function createLLMProvider(): LLMProvider {
  const providerId = process.env.JARVIS_LLM_PROVIDER?.trim();
  const model = process.env.JARVIS_LLM_MODEL?.trim();

  if (!providerId) {
    throw new LLMProviderError("configuration", { safeDetail: "JARVIS_LLM_PROVIDER is not set" });
  }
  if (!model) {
    throw new LLMProviderError("configuration", { safeDetail: "JARVIS_LLM_MODEL is not set" });
  }
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerId)) {
    throw new LLMProviderError("configuration", { safeDetail: `unsupported provider: ${providerId}` });
  }

  switch (providerId as SupportedProvider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        throw new LLMProviderError("configuration", { providerId, safeDetail: "ANTHROPIC_API_KEY is not set" });
      }
      return createAnthropicProvider({ apiKey, model });
    }
    default:
      throw new LLMProviderError("configuration", { safeDetail: `unsupported provider: ${providerId}` });
  }
}
