import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import {
  fetchJsonWithTimeout,
  withRetry,
  logIntegrationEvent,
  newCorrelationId,
  IntegrationApiError,
  IntegrationAuthError,
  IntegrationConfigError,
} from "@/lib/net";
import {
  getGoogleConfig,
  GOOGLE_SCOPE,
  GOOGLE_TOKEN_URL,
  type GoogleConfig,
} from "./config";

/**
 * Google OAuth connection lifecycle for the single shared agency calendar.
 *
 * Mirrors the QuickBooks connection layer (service-role persistence, encrypted
 * tokens, transparent refresh) but is built on the reusable src/lib/net
 * primitives so every call has a hard timeout, bounded retry and structured
 * logging. All persistence uses the service-role client into the RLS-locked,
 * single-row `calendar_credentials` table — tokens are never exposed to
 * RLS-scoped reads or the browser.
 */

const INTEGRATION = "google";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  /** Only returned on the FIRST consent (access_type=offline + prompt=consent). */
  refresh_token?: string;
  /** Present because we request openid+email; carries the consenting account. */
  id_token?: string;
}

/** Decode the email claim from a Google id_token (JWT). Null if unavailable. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * POST to Google's token endpoint (code exchange or refresh). Times out, retries
 * transient failures, and translates an `invalid_grant` into a terminal
 * IntegrationAuthError so callers surface "reconnect required" rather than retry.
 */
async function requestTokens(
  cfg: GoogleConfig,
  body: Record<string, string>,
  opts: {
    correlationId: string;
    event: "token_exchange" | "token_refresh";
    retries: number;
  }
): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    ...body,
  });

  try {
    const tokens = await withRetry(
      () =>
        fetchJsonWithTimeout<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
          integration: INTEGRATION,
          timeoutMs: 10_000,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: params.toString(),
        }),
      {
        retries: opts.retries,
        onRetry: (attempt) =>
          logIntegrationEvent("warn", {
            integration: INTEGRATION,
            event: opts.event,
            correlationId: opts.correlationId,
            outcome: "failure",
            reason: `transient; retry ${attempt}`,
          }),
      }
    );
    logIntegrationEvent("info", {
      integration: INTEGRATION,
      event: opts.event,
      correlationId: opts.correlationId,
      outcome: "success",
    });
    return tokens;
  } catch (err) {
    // A revoked/expired grant is terminal — never retried, surfaced as auth error.
    if (err instanceof IntegrationApiError && /invalid_grant/.test(err.body)) {
      throw new IntegrationAuthError(
        INTEGRATION,
        "Google authorization is no longer valid (invalid_grant)."
      );
    }
    throw err;
  }
}

/** Public connection status (no secrets) for the admin Integrations page. */
export interface GoogleConnectionStatus {
  configured: boolean;
  connected: boolean;
  status: "connected" | "reconnect_required" | "disconnected";
  googleAccountEmail: string | null;
  googleCalendarId: string | null;
  connectedAt: string | null;
}

/**
 * Best-effort connection status for the UI. Reads ONLY the DB row (no network
 * I/O, so it can never hang a render) and swallows every error into a safe
 * "disconnected" result — the Integrations page must render regardless of
 * Google's state.
 */
export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const cfg = getGoogleConfig();
  const base = {
    configured: cfg !== null,
    connected: false,
    status: "disconnected" as const,
    googleAccountEmail: null,
    googleCalendarId: null,
    connectedAt: null,
  };
  if (!cfg) return base;

  try {
    const admin = createAdminClient();
    // Never read the secret ciphertext for a UI status: status='connected' is
    // only ever set alongside a stored token (and cleared on disconnect).
    const { data } = await admin
      .from("calendar_credentials")
      .select("status, google_account_email, google_calendar_id, connected_at")
      .eq("id", 1)
      .maybeSingle();

    if (!data) return { ...base, configured: true };
    return {
      configured: true,
      connected: data.status === "connected",
      status: data.status,
      googleAccountEmail: data.google_account_email,
      googleCalendarId: data.google_calendar_id,
      connectedAt: data.connected_at,
    };
  } catch {
    return { ...base, configured: true };
  }
}

/**
 * Exchange an OAuth authorization code for tokens, verify the consenting account
 * is the configured shared account, and persist the encrypted refresh token.
 * Called from the callback route after admin + CSRF verification.
 *
 * Throws (never silently succeeds) on: not configured, wrong account, a missing
 * refresh token, or an upstream failure — the callback maps each to a status.
 */
export async function exchangeAndStore(
  code: string,
  connectedBy: string | null,
  correlationId: string
): Promise<void> {
  const cfg = getGoogleConfig();
  if (!cfg) throw new IntegrationConfigError(INTEGRATION, "Google is not configured.");

  // The auth code is single-use: do NOT retry the exchange.
  const tokens = await requestTokens(
    cfg,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    },
    { correlationId, event: "token_exchange", retries: 0 }
  );

  // Refuse any account other than the configured shared calendar account.
  const email = emailFromIdToken(tokens.id_token);
  const expected = cfg.calendarId.toLowerCase();
  if (email && email !== expected) {
    logIntegrationEvent("warn", {
      integration: INTEGRATION,
      event: "token_exchange",
      correlationId,
      outcome: "failure",
      reason: "wrong_account",
    });
    throw new IntegrationAuthError(
      INTEGRATION,
      "A different Google account was used than the configured shared calendar.",
      "wrong_account"
    );
  }

  // We force access_type=offline + prompt=consent, so a refresh token is
  // expected. Without one we cannot operate long-term — treat as a failure.
  if (!tokens.refresh_token) {
    throw new IntegrationAuthError(
      INTEGRATION,
      "Google did not return a refresh token. Remove the app's access and reconnect."
    );
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  await admin.from("calendar_credentials").upsert(
    {
      id: 1,
      provider: "google",
      google_account_email: email ?? cfg.calendarId,
      google_calendar_id: cfg.calendarId,
      scopes: GOOGLE_SCOPE,
      status: "connected",
      refresh_token_enc: encryptToken(tokens.refresh_token, cfg.tokenSecret),
      connected_by: connectedBy,
      connected_at: now,
      updated_at: now,
      disconnected_by: null,
      disconnected_at: null,
    },
    { onConflict: "id" }
  );
}

/** Flip the stored credential to reconnect_required (grant revoked/expired). */
async function markReconnectRequired(): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("calendar_credentials")
      .update({ status: "reconnect_required", updated_at: new Date().toISOString() })
      .eq("id", 1);
  } catch {
    // Non-fatal: the caller already has a terminal auth error to surface.
  }
}

export interface GoogleAccessToken {
  accessToken: string;
  expiresInSec: number;
}

/**
 * Return a fresh Google access token, minted from the stored refresh token.
 *
 * There is no access-token column — access tokens are ephemeral, so we always
 * derive one on demand from the encrypted refresh token. Consumed by Phase 3
 * (calendar/Meet). On a revoked grant the credential is flipped to
 * reconnect_required and an IntegrationAuthError is thrown; callers degrade
 * gracefully and never crash a render.
 */
export async function getAccessToken(
  correlationId: string = newCorrelationId()
): Promise<GoogleAccessToken> {
  const cfg = getGoogleConfig();
  if (!cfg) throw new IntegrationConfigError(INTEGRATION, "Google is not configured.");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("calendar_credentials")
    .select("status, refresh_token_enc")
    .eq("id", 1)
    .maybeSingle();

  if (!row || !row.refresh_token_enc || row.status !== "connected") {
    throw new IntegrationAuthError(
      INTEGRATION,
      "Google is not connected. Connect it in Settings → Integrations."
    );
  }

  const refreshToken = decryptToken(row.refresh_token_enc, cfg.tokenSecret);

  let tokens: GoogleTokenResponse;
  try {
    tokens = await requestTokens(
      cfg,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { correlationId, event: "token_refresh", retries: 2 }
    );
  } catch (err) {
    if (err instanceof IntegrationAuthError) {
      await markReconnectRequired();
      logIntegrationEvent("error", {
        integration: INTEGRATION,
        event: "terminal_failure",
        correlationId,
        outcome: "failure",
        reason: "refresh_invalid_grant",
      });
    }
    throw err;
  }

  // Google rarely rotates refresh tokens, but honour one if returned.
  if (tokens.refresh_token) {
    await admin
      .from("calendar_credentials")
      .update({
        refresh_token_enc: encryptToken(tokens.refresh_token, cfg.tokenSecret),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
  }

  return { accessToken: tokens.access_token, expiresInSec: tokens.expires_in };
}

/**
 * Disconnect Google: forget the stored refresh token and mark the credential
 * disconnected. The admin can reconnect any time. Best-effort — returns whether
 * it succeeded rather than throwing into a UI action.
 */
export async function disconnectGoogle(
  disconnectedBy: string | null,
  correlationId: string = newCorrelationId()
): Promise<{ ok: boolean; error?: string }> {
  try {
    const now = new Date().toISOString();
    const admin = createAdminClient();
    const { error } = await admin
      .from("calendar_credentials")
      .update({
        status: "disconnected",
        refresh_token_enc: null,
        disconnected_by: disconnectedBy,
        disconnected_at: now,
        updated_at: now,
      })
      .eq("id", 1);
    logIntegrationEvent("info", {
      integration: INTEGRATION,
      event: "disconnect",
      correlationId,
      outcome: error ? "failure" : "success",
      reason: error?.message,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "Server is missing its service-role key, so Google could not be disconnected.",
    };
  }
}
