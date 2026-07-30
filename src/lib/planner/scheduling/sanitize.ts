import {
  IntegrationApiError,
  IntegrationAuthError,
  IntegrationConfigError,
  IntegrationNetworkError,
  IntegrationTimeoutError,
} from "@/lib/net";

/**
 * Reduce any thrown error to a short, SAFE code for storage/logging.
 *
 * This is the only value written to last_sync_error / last_meet_error and the
 * only `reason` logged. It deliberately NEVER includes provider response bodies,
 * tokens, attendee data, headers or stack traces (correction 6) — just a code
 * like `timeout`, `network`, `api_409`, `invalid_grant`.
 */
export function sanitizeSyncError(err: unknown): string {
  if (err instanceof IntegrationTimeoutError) return "timeout";
  if (err instanceof IntegrationAuthError) return err.code ?? "auth_failed";
  if (err instanceof IntegrationNetworkError) return "network";
  if (err instanceof IntegrationApiError) return `api_${err.status}`;
  if (err instanceof IntegrationConfigError) return "not_configured";
  return "error";
}

/** Auth errors are terminal for the credential → the projection is `disconnected`. */
export function isDisconnectError(err: unknown): boolean {
  return err instanceof IntegrationAuthError;
}
