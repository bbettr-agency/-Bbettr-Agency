import "server-only";
import { isTransientIntegrationError } from "./errors";

/**
 * Bounded retry with exponential backoff for external integration calls.
 *
 * Reusable across providers. By default it only retries transient failures
 * (timeouts, transport errors, HTTP 429/5xx) — terminal failures (a revoked
 * OAuth grant, a single-use auth code, a 4xx) are re-thrown immediately so we
 * never, for example, replay a consumed authorization code.
 */

export interface RetryOptions {
  /** Extra attempts after the first. Default 2 (so up to 3 tries total). */
  retries?: number;
  /** Base backoff; delay = baseDelayMs * 2^(attempt-1). Default 250ms. */
  baseDelayMs?: number;
  /** Decide whether an error is worth retrying. Default: transient only. */
  isRetryable?: (err: unknown) => boolean;
  /** Optional hook fired before each retry (e.g. structured logging). */
  onRetry?: (attempt: number, err: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. Re-throws the
 * last error once retries are exhausted or the error is non-retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 250,
    isRetryable = isTransientIntegrationError,
    onRetry,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const canRetry = attempt <= retries && isRetryable(err);
      if (!canRetry) throw err;
      onRetry?.(attempt, err);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the type.
  throw lastErr;
}
