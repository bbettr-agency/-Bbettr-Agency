import "server-only";

/**
 * Jarvis Intelligence — provider error taxonomy (Slice B). SERVER-ONLY.
 *
 * Part of the executable provider runtime (the error `complete()` throws), so it
 * is not importable into browser/UI code. Nothing outside src/lib/jarvis/llm/
 * consumes it today; if the UI later needs to show an error kind, extract a
 * browser-safe display type deliberately rather than importing this runtime class.
 *
 * Small, vendor-neutral classification sufficient for the orchestrator (Slice C)
 * to decide retryable vs non-retryable and to log SAFELY. It never carries raw
 * provider response bodies, credentials, prompts, or secrets — only a short,
 * caller-supplied safe diagnostic string.
 */
export type LLMErrorKind =
  | "configuration" // missing/invalid config (e.g. no provider/model) — NOT retryable
  | "timeout" // exceeded the call budget — retryable
  | "rate_limit" // provider throttled — retryable
  | "provider_4xx" // client-side/request error — NOT retryable
  | "provider_5xx" // provider server error — retryable
  | "unavailable" // provider unreachable / network — retryable
  | "invalid_response"; // provider returned something unusable — NOT retryable

const RETRYABLE: ReadonlySet<LLMErrorKind> = new Set(["timeout", "rate_limit", "provider_5xx", "unavailable"]);

/** Whether a failure of this kind is safe to retry (transient). Pure. */
export function isRetryableKind(kind: LLMErrorKind): boolean {
  return RETRYABLE.has(kind);
}

export interface LLMProviderErrorOptions {
  /** Short, SAFE diagnostic for trusted logs. NEVER secrets/raw provider bodies/prompts. */
  safeDetail?: string;
  providerId?: string;
  /** Override the default retryability derived from `kind` (rarely needed). */
  retryable?: boolean;
  /** Underlying cause (kept for the server stack only; never surfaced to users). */
  cause?: unknown;
}

/**
 * The single error type the provider boundary throws. Its `message` is safe to
 * log; user-facing copy is produced by the orchestrator, not from this message.
 */
export class LLMProviderError extends Error {
  readonly kind: LLMErrorKind;
  readonly retryable: boolean;
  readonly providerId?: string;
  readonly safeDetail?: string;

  constructor(kind: LLMErrorKind, opts: LLMProviderErrorOptions = {}) {
    super(`llm_provider_error:${kind}${opts.safeDetail ? ` (${opts.safeDetail})` : ""}`);
    this.name = "LLMProviderError";
    this.kind = kind;
    this.retryable = opts.retryable ?? isRetryableKind(kind);
    this.providerId = opts.providerId;
    this.safeDetail = opts.safeDetail;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export function isLLMProviderError(e: unknown): e is LLMProviderError {
  return e instanceof LLMProviderError;
}
