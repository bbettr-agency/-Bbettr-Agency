import "server-only";

import Anthropic, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult, LLMUsage } from "./provider";
import { LLMProviderError, type LLMErrorKind } from "./errors";

/**
 * Jarvis Intelligence — Anthropic Claude adapter (Slice E, SERVER-ONLY).
 *
 * The FIRST real LLMProvider. It is an implementation detail behind the
 * provider-independent `LLMProvider` contract: no Anthropic-specific type or
 * behavior leaks upward into the orchestrator. It is transport, not prompt
 * strategy — the Jarvis prompt/response contract (Slice C) remains authoritative.
 *
 * Security / boundary invariants:
 *   • server-only; never imported into client code; never `dangerouslyAllowBrowser`.
 *   • the API key is used to construct the SDK client and NEVER placed in results,
 *     errors, telemetry, provenance, or logs.
 *   • the orchestrator/provider-call layer owns the ONE overall deadline + retry
 *     policy, so the SDK client is built with `maxRetries: 0` (no nested retries)
 *     and the supplied AbortSignal is the cancellation authority. The adapter adds
 *     no timeout budget of its own.
 *   • only TEXT content blocks are read; hidden thinking/reasoning blocks are never
 *     extracted, never mapped to reasoning_summary, never persisted.
 *   • provider/model/usage/finishReason are trusted adapter/response values, never
 *     taken from model-authored text.
 */

export const ANTHROPIC_PROVIDER_ID = "anthropic";

/** Minimal structural view of the SDK we depend on — keeps the adapter loosely
 *  coupled and unit-testable with a fake client (no network, no key). */
export interface AnthropicMessageCreateBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Extended thinking is DISABLED for Jarvis operational chat. Deliberate V1
   * policy (not a casual hack), justified by four facts:
   *   1. Jarvis extracts ONLY text blocks — any hidden thinking is discarded, so
   *      thinking tokens would be pure waste (billed, then thrown away);
   *   2. on Sonnet 5, `max_tokens` covers thinking + response, so adaptive
   *      thinking under the bounded ~1200-token budget could consume it and
   *      TRUNCATE the strict JSON contract (→ invalid_response, a reliability
   *      failure — safe, but Jarvis would frequently fail to answer);
   *   3. Jarvis's user-safe reasoning lives in the explicit `reasoning_summary`
   *      JSON field, NOT in hidden chain-of-thought, so no user value is lost;
   *   4. Sonnet 5 accepts `{ type: "disabled" }` cleanly (no beta, no sampling).
   * This is an adapter-local TRANSPORT detail — the provider-independent
   * LLMProvider contract is unchanged, and the central maxOutputTokens semantics
   * are untouched (raise JARVIS_LLM_MAX_OUTPUT_TOKENS, bounded 1..4000, if needed).
   * NOTE: a thinking-MANDATORY model (e.g. Opus 5.5 / Fable) would 400 on this and
   * surface as provider_4xx (safe failure) — the adapter targets Sonnet 5.
   */
  thinking?: { type: "disabled" };
}
export interface AnthropicContentBlockLike {
  type: string;
  text?: string;
  [k: string]: unknown;
}
export interface AnthropicMessageLike {
  content: AnthropicContentBlockLike[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
  model?: string;
}
export interface AnthropicClientLike {
  messages: {
    create(
      body: AnthropicMessageCreateBody,
      options?: { signal?: AbortSignal; maxRetries?: number }
    ): Promise<AnthropicMessageLike>;
  };
}

export interface AnthropicAdapterConfig {
  apiKey: string;
  /** Trusted, configured model id (e.g. "claude-sonnet-5") — never model-supplied. */
  model: string;
  /** Seam: build the SDK client. Defaults to the real @anthropic-ai/sdk with
   *  maxRetries forced to 0. Tests inject a fake to avoid any network/key. */
  createClient?: (opts: { apiKey: string; maxRetries: number }) => AnthropicClientLike;
}

/** Extract ONLY text blocks, in order, concatenated deterministically. Non-text
 *  blocks (including any thinking/reasoning) are ignored entirely. */
function extractText(content: AnthropicContentBlockLike[]): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") out += block.text;
  }
  return out;
}

/** Map Anthropic stop_reason → provider-independent finishReason. Known reasons
 *  normalize; unknown/new reasons pass through conservatively (never throw). */
function mapFinishReason(stop: string | null | undefined): string | null {
  switch (stop) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case null:
    case undefined:
      return null;
    default:
      return stop; // stop_sequence | tool_use | pause_turn | refusal | future values
  }
}

function mapUsage(usage: AnthropicMessageLike["usage"]): LLMUsage {
  const input = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const output = usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  return { inputTokens: input, outputTokens: output };
}

/** Map an SDK/API failure into the existing Slice-B taxonomy, using typed status
 *  where available (never string-matching human messages). Preserves the existing
 *  retryability semantics (errors.ts derives retryable from the kind). Never
 *  includes the API key or raw provider bodies in the safe detail. */
function mapError(e: unknown, signal: AbortSignal | undefined): LLMProviderError {
  if (e instanceof LLMProviderError) return e;

  // Cancellation via the orchestrator-owned deadline/signal ⇒ timeout.
  if (signal?.aborted || e instanceof APIUserAbortError || (e as { name?: string })?.name === "APIUserAbortError") {
    return new LLMProviderError("timeout", { providerId: ANTHROPIC_PROVIDER_ID, safeDetail: "aborted" });
  }
  // Connection timeout is also a timeout; other connection failures are unavailable.
  if (e instanceof APIConnectionTimeoutError || (e as { name?: string })?.name === "APIConnectionTimeoutError") {
    return new LLMProviderError("timeout", { providerId: ANTHROPIC_PROVIDER_ID, safeDetail: "connection_timeout" });
  }

  const status =
    e instanceof APIError && typeof e.status === "number"
      ? e.status
      : typeof (e as { status?: unknown })?.status === "number"
        ? ((e as { status: number }).status)
        : undefined;

  if (status !== undefined) {
    let kind: LLMErrorKind;
    if (status === 429) kind = "rate_limit";
    // 408/409 are provider-documented TRANSIENT conditions the SDK would auto-retry;
    // with SDK retries disabled, Jarvis must keep them RETRYABLE (do not let them
    // fall into non-retryable provider_4xx). 408 is a request timeout → `timeout`;
    // 409 is a transient conflict → `unavailable` (the honest retryable kind).
    else if (status === 408) kind = "timeout";
    else if (status === 409) kind = "unavailable";
    else if (status >= 500) kind = "provider_5xx"; // includes 529 overloaded (retryable)
    else if (status === 401) kind = "configuration"; // invalid/missing/revoked credential (non-retryable)
    else if (status >= 400) kind = "provider_4xx"; // 400/402/403/404/413/… (non-retryable)
    else kind = "unavailable";
    return new LLMProviderError(kind, { providerId: ANTHROPIC_PROVIDER_ID, safeDetail: `http_${status}` });
  }

  if (e instanceof APIConnectionError || (e as { name?: string })?.name === "APIConnectionError") {
    return new LLMProviderError("unavailable", { providerId: ANTHROPIC_PROVIDER_ID, safeDetail: "connection_error" });
  }

  // Unknown throwable — conservative, retryable-neutral default.
  return new LLMProviderError("unavailable", { providerId: ANTHROPIC_PROVIDER_ID, safeDetail: "unknown_error" });
}

const defaultCreateClient = (opts: { apiKey: string; maxRetries: number }): AnthropicClientLike =>
  // maxRetries: 0 — Jarvis owns retry/deadline; the SDK must NOT retry underneath.
  new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries }) as unknown as AnthropicClientLike;

export function createAnthropicProvider(config: AnthropicAdapterConfig): LLMProvider {
  if (!config.apiKey) throw new LLMProviderError("configuration", { safeDetail: "missing api key" });
  if (!config.model) throw new LLMProviderError("configuration", { safeDetail: "missing model" });

  const make = config.createClient ?? defaultCreateClient;
  const client = make({ apiKey: config.apiKey, maxRetries: 0 });
  const model = config.model;

  return {
    id: ANTHROPIC_PROVIDER_ID,
    model,
    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
      const started = Date.now();
      try {
        const message = await client.messages.create(
          {
            model, // trusted configured model
            max_tokens: request.maxOutputTokens,
            system: request.system, // top-level system; NEVER a system-role message
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            thinking: { type: "disabled" }, // reserve the whole budget for the JSON contract (see body type)
          },
          // The orchestrator's AbortSignal is the cancellation authority; keep the
          // SDK from adding its own retries on this request too.
          { signal: request.signal, maxRetries: 0 }
        );

        const text = extractText(message.content);
        if (text.length === 0) {
          throw new LLMProviderError("invalid_response", {
            providerId: ANTHROPIC_PROVIDER_ID,
            safeDetail: "no_text_content",
          });
        }

        return {
          text,
          providerId: ANTHROPIC_PROVIDER_ID, // trusted
          model, // trusted configured identity (never from model text)
          finishReason: mapFinishReason(message.stop_reason),
          usage: mapUsage(message.usage),
          latencyMs: Date.now() - started,
        };
      } catch (e) {
        throw mapError(e, request.signal);
      }
    },
  };
}
