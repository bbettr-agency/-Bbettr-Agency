import "server-only";

import type { LLMProvider } from "./provider";
import { LLMProviderError } from "./errors";

/**
 * Jarvis Intelligence — provider factory (Slice B, server-only). FAIL-CLOSED.
 *
 * Selects a provider from configuration ONLY. It never:
 *   • silently falls back to a real provider,
 *   • silently chooses Anthropic,
 *   • returns the test mock (the mock is not imported here and is never reachable
 *     through the factory — see mock.ts, which is test-only).
 * In Slice B no real adapter exists yet, so every path throws a `configuration`
 * error; the Anthropic adapter is wired in Slice E. This keeps the boundary
 * provider-independent and un-tied to any vendor.
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
    case "anthropic":
      // Adapter (and ANTHROPIC_API_KEY handling) arrives in Slice E — fail closed.
      throw new LLMProviderError("configuration", {
        providerId,
        safeDetail: "anthropic adapter not implemented until Slice E",
      });
    default:
      throw new LLMProviderError("configuration", { safeDetail: `unsupported provider: ${providerId}` });
  }
}
