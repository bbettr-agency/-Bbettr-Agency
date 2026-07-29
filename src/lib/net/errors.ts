/**
 * Generic, provider-agnostic error primitives for external integrations.
 *
 * These are deliberately NOT Google-specific: any integration (Google today,
 * QuickBooks and others over time) throws these so callers can branch on a
 * stable, shared taxonomy instead of provider-bespoke error types. The
 * `integration` field carries which provider raised it (e.g. "google").
 *
 * The golden rule for every consumer: an integration failing must never crash a
 * Portal render. These typed errors exist so trusted server code can catch a
 * known failure mode and degrade gracefully.
 */

/** Base class for every integration failure. Never carries secrets. */
export class IntegrationError extends Error {
  readonly integration: string;
  constructor(integration: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.integration = integration;
  }
}

/** A network call exceeded its deadline (AbortSignal.timeout fired). */
export class IntegrationTimeoutError extends IntegrationError {
  readonly timeoutMs: number;
  constructor(integration: string, timeoutMs: number) {
    super(integration, `${integration} request timed out after ${timeoutMs}ms.`);
    this.timeoutMs = timeoutMs;
  }
}

/** A transport-level failure (DNS, connection reset, TLS, etc.). */
export class IntegrationNetworkError extends IntegrationError {
  constructor(integration: string, detail?: string) {
    super(
      integration,
      `${integration} network error${detail ? `: ${detail}` : "."}`
    );
  }
}

/** The provider returned a non-2xx HTTP response. Carries status + raw body. */
export class IntegrationApiError extends IntegrationError {
  readonly status: number;
  readonly body: string;
  constructor(integration: string, status: number, body: string) {
    super(integration, `${integration} API ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Authorization is broken and NOT self-recoverable — the credential is
 * revoked/expired (e.g. OAuth `invalid_grant`) or the wrong account connected.
 * The caller should surface a "reconnect required" state, not retry. The
 * optional `code` lets callers branch on a specific cause (e.g. "wrong_account")
 * without matching on the human-readable message.
 */
export class IntegrationAuthError extends IntegrationError {
  readonly code?: string;
  constructor(integration: string, message: string, code?: string) {
    super(integration, message);
    this.code = code;
  }
}

/** The integration isn't configured on this server (missing env). Inert state. */
export class IntegrationConfigError extends IntegrationError {}

/**
 * Whether an error is worth retrying: timeouts, transport failures, and
 * transient HTTP statuses (429 + 5xx). Auth/config/4xx errors are terminal and
 * must NOT be retried (e.g. a single-use OAuth code, or a revoked grant).
 */
export function isTransientIntegrationError(err: unknown): boolean {
  if (err instanceof IntegrationTimeoutError) return true;
  if (err instanceof IntegrationNetworkError) return true;
  if (err instanceof IntegrationApiError) {
    return err.status === 429 || (err.status >= 500 && err.status <= 599);
  }
  return false;
}
