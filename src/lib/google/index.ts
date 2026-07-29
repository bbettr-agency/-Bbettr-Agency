import "server-only";
import {
  getGoogleConfig,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_SCOPE,
} from "./config";
import {
  disconnectGoogle,
  exchangeAndStore,
  getAccessToken,
  getGoogleConnectionStatus,
} from "./connection";

/**
 * Public Google surface used by the rest of the app. The OAuth routes and admin
 * actions only import from here.
 */

export {
  getGoogleConnectionStatus,
  exchangeAndStore,
  disconnectGoogle,
  getAccessToken,
};
export type { GoogleConnectionStatus, GoogleAccessToken } from "./connection";

/** Is Google configured (env vars present) on this server? */
export function isGoogleConfigured(): boolean {
  return getGoogleConfig() !== null;
}

/**
 * Build Google's consent URL. `state` is an opaque CSRF token the caller stores
 * (cookie) and re-checks in the callback. `access_type=offline` + `prompt=consent`
 * guarantee a refresh token is issued.
 */
export function getGoogleAuthorizeUrl(state: string): string | null {
  const cfg = getGoogleConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    // Hint the shared account so the chooser pre-selects the right login.
    login_hint: cfg.calendarId,
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}
