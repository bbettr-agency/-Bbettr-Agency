import "server-only";

/**
 * Jarvis Intelligence — provider-independent LLM contract (Slice B).
 *
 * SERVER-ONLY: this is the executable provider runtime contract (LLMProvider
 * .complete). Browser/UI code must never import the runtime provider layer; if a
 * browser-safe DISPLAY type is ever needed, extract it deliberately into a
 * separate shared module rather than importing from here. (Type-only imports of
 * these interfaces are erased at compile time and remain safe anywhere.)
 *
 * Pure types. This is the ONLY boundary between Jarvis and any model vendor.
 * It is deliberately narrow: a bounded request in, a model response out. It does
 * NOT carry — and must never carry — any authority or data-access capability:
 * no Supabase client, no JarvisContext, no grants, no workspace authority, no
 * capability-execution functions, no service-role, no DB access. The provider is
 * a computation, not a security boundary; all authority lives in the trusted
 * orchestrator/F1 layers (Slice C+).
 *
 * Slice B intentionally does NOT define any Jarvis operational response schema
 * (proposed intents, memory candidates, provenance, uncertainty, reasoning
 * summary) — the provider returns raw model text; parsing Jarvis semantics is
 * Slice C/D.
 */

/** A conversation turn sent to the model. There is no `system` role here — the
 *  trusted system instructions travel as the separate `system` field below, so
 *  message content can never be treated as system instructions. */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMCompletionRequest {
  /** Trusted system instructions, assembled by the caller (never model/user text). */
  system: string;
  /** Bounded conversation history + the current user turn. */
  messages: LLMMessage[];
  /** Hard cap on model output length for this call. */
  maxOutputTokens: number;
  /**
   * The approved wall-clock budget for this call. AUTHORITY NOTE: the provider is
   * NOT responsible for guaranteeing the overall turn deadline — the trusted
   * orchestrator (Slice C) owns it and MUST independently abort via `signal` when
   * the deadline expires. An adapter MAY apply its own timeout as extra defense,
   * but the caller/orchestrator remains authoritative.
   */
  timeoutMs: number;
  /** Cancellation signal the orchestrator wires to the deadline; adapters honor it. */
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMCompletionResult {
  /** Raw model output text. No Jarvis semantics are parsed at this layer. */
  text: string;
  /** Adapter-derived, trusted metadata (never model-claimed). */
  providerId: string;
  model: string;
  /** Provider-mapped stop reason (e.g. "stop" | "length" | "content_filter"), or null. */
  finishReason: string | null;
  usage: LLMUsage;
  latencyMs: number;
}

/**
 * A configured provider. `complete` resolves with a result on success, or throws
 * an LLMProviderError (see errors.ts) on any failure — so callers classify
 * retryable vs non-retryable via the typed error, not by parsing strings.
 */
export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
