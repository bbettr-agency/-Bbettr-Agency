import "server-only";
import {
  IntegrationApiError,
  IntegrationNetworkError,
  IntegrationTimeoutError,
} from "./errors";

/**
 * Reusable server-side HTTP transport for external integrations.
 *
 * The one job here is the project invariant: no external dependency may hang or
 * crash the Portal. Every outbound call gets a hard deadline via
 * `AbortSignal.timeout`, and every failure surfaces as a typed, provider-tagged
 * IntegrationError the caller can catch. Google is the first consumer; other
 * integrations (QuickBooks, …) can migrate onto this over time.
 *
 * Native `fetch` is used deliberately (not an SDK transport) — it sidesteps the
 * RSC "ArrayBuffer is not detachable" failures heavier clients hit, and keeps
 * one transport across every integration.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Provider slug used to tag errors, e.g. "google". */
  integration: string;
  /** Hard deadline in ms. Defaults to 10s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * `fetch` with a mandatory timeout. Resolves to a Response (of any status —
 * status handling is the caller's), or throws IntegrationTimeoutError /
 * IntegrationNetworkError. It never hangs longer than `timeoutMs`.
 */
export async function fetchWithTimeout(
  url: string,
  { integration, timeoutMs = DEFAULT_TIMEOUT_MS, ...init }: FetchWithTimeoutOptions
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // AbortSignal.timeout rejects with a DOMException named "TimeoutError".
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new IntegrationTimeoutError(integration, timeoutMs);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new IntegrationNetworkError(integration, detail);
  }
}

/**
 * `fetchWithTimeout` + JSON parsing, throwing IntegrationApiError on any non-2xx
 * response (the raw body is captured for diagnostics, never logged wholesale).
 * Use for JSON APIs where a non-2xx is an error.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  opts: FetchWithTimeoutOptions
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationApiError(opts.integration, res.status, body);
  }
  return (await res.json()) as T;
}
