/**
 * QuickBooks Online configuration, read from server-only environment variables.
 *
 * Everything QBO-specific is isolated under src/lib/quickbooks. If these vars
 * are absent the integration simply reports "not configured" and the rest of
 * the portal is unaffected.
 */

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  tokenSecret: string;
}

/** OAuth scope for invoicing (accounting). */
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

/** Intuit's fixed OAuth endpoints (same for sandbox and production). */
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/** API minor version — pin so request/response shapes are stable. */
export const QBO_MINOR_VERSION = "75";

/** Base API host depends on the environment. */
export function apiBaseUrl(env: QboEnvironment): string {
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/**
 * Read the QBO config from the environment, or null if it isn't fully set up.
 * Callers treat null as "QuickBooks not configured on this server".
 */
export function getQboConfig(): QboConfig | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const tokenSecret = process.env.QBO_TOKEN_SECRET;
  if (!clientId || !clientSecret || !tokenSecret) return null;

  const environment: QboEnvironment =
    process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";

  // Default the redirect to the public app URL if not explicitly provided.
  const redirectUri =
    process.env.QBO_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/quickbooks/callback`;

  if (!redirectUri.startsWith("http")) return null;

  return { clientId, clientSecret, redirectUri, environment, tokenSecret };
}
