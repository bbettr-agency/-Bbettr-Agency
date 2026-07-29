/**
 * Reusable server-side networking + observability primitives for external
 * integrations. Provider-agnostic by design: Google is the first consumer and
 * other integrations can migrate onto these over time.
 */

export {
  IntegrationError,
  IntegrationTimeoutError,
  IntegrationNetworkError,
  IntegrationApiError,
  IntegrationAuthError,
  IntegrationConfigError,
  isTransientIntegrationError,
} from "./errors";

export {
  fetchWithTimeout,
  fetchJsonWithTimeout,
  type FetchWithTimeoutOptions,
} from "./http";

export { withRetry, type RetryOptions } from "./retry";

export {
  logIntegrationEvent,
  newCorrelationId,
  type IntegrationEvent,
  type IntegrationLogLevel,
  type IntegrationLogFields,
} from "./log";
