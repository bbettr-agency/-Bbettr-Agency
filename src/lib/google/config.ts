import "server-only";

/**
 * Google OAuth configuration for the single shared agency calendar account,
 * read from server-only environment variables.
 *
 * Everything Google-specific is isolated under src/lib/google. If these vars are
 * absent the integration simply reports "not configured" and the rest of the
 * Portal is unaffected — the project invariant: no external dependency may ever
 * prevent the Portal from loading or functioning.
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenSecret: string;
  /**
   * The expected shared account/calendar (e.g. info@bbettragency.com). The
   * OAuth callback refuses any other account, and calendar operations run on
   * this account's primary calendar.
   */
  calendarId: string;
}

/**
 * OAuth scopes. Least privilege:
 *  - calendar.events → create/read events (and Meet links) in Phase 3;
 *  - openid + email  → let the callback verify WHICH Google account consented,
 *    so we can refuse anything other than the configured shared account.
 * No broader calendar, Drive, or Gmail access is ever requested.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];
export const GOOGLE_SCOPE = GOOGLE_SCOPES.join(" ");

/** Google's fixed OAuth 2.0 endpoints. */
export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Read the Google config from the environment, or null if it isn't fully set
 * up. Callers treat null as "Google not configured on this server".
 */
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const tokenSecret = process.env.GOOGLE_TOKEN_SECRET;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!clientId || !clientSecret || !tokenSecret || !calendarId) return null;

  // Default the redirect to the public app URL if not explicitly provided.
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/google/callback`;

  if (!redirectUri.startsWith("http")) return null;

  return { clientId, clientSecret, redirectUri, tokenSecret, calendarId };
}
