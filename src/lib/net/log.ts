import "server-only";
import { randomUUID } from "crypto";

/**
 * Lightweight structured logging for external integrations.
 *
 * One JSON line per event, so logs are greppable and machine-parseable in the
 * platform log drain. Every OAuth start, callback, token refresh and terminal
 * failure is tagged with a correlation id so a single connection attempt can be
 * traced end to end across route handler → connection layer → provider call.
 *
 * SECURITY: this logger must NEVER receive secrets. Pass correlation ids, event
 * names, HTTP status codes and safe reason strings only — never tokens, codes,
 * client secrets, or the encrypted-token ciphertext.
 */

export type IntegrationLogLevel = "info" | "warn" | "error";

/** The lifecycle points we trace for every integration. */
export type IntegrationEvent =
  | "oauth_start"
  | "oauth_callback"
  | "token_exchange"
  | "token_refresh"
  | "disconnect"
  | "terminal_failure";

export interface IntegrationLogFields {
  /** Provider slug, e.g. "google". */
  integration: string;
  event: IntegrationEvent;
  /** Ties every line of one connection attempt together. */
  correlationId: string;
  outcome?: "start" | "success" | "failure";
  /** HTTP status when relevant (no bodies — those may hold sensitive data). */
  status?: number;
  /** Safe, secret-free explanation (error class name, "invalid_grant", etc.). */
  reason?: string;
}

/** Mint a correlation id for one integration flow. */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Emit one structured log line. Errors go to stderr, warnings/info to stdout.
 * Silently degrades — logging must never throw into an integration flow.
 */
export function logIntegrationEvent(
  level: IntegrationLogLevel,
  fields: IntegrationLogFields
): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope: "integration",
      ...fields,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    // Never let logging break the caller.
  }
}
