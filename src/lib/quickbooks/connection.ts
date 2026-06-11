import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "./crypto";
import {
  getQboConfig,
  QBO_TOKEN_URL,
  type QboConfig,
  type QboEnvironment,
} from "./config";

/**
 * QBO OAuth connection lifecycle: exchange the auth code, persist encrypted
 * tokens (single-row `quickbooks_connection`), and hand callers a valid access
 * token, transparently refreshing it when it's close to expiry.
 *
 * All persistence uses the service-role client — tokens are never exposed to
 * RLS-scoped reads or the browser.
 */

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

function basicAuth(cfg: QboConfig): string {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function requestTokens(
  cfg: QboConfig,
  body: Record<string, string>
): Promise<TokenResponse> {
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(cfg)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`QuickBooks token request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Public connection status (no secrets) for the admin Integrations page. */
export interface QboConnectionStatus {
  configured: boolean;
  connected: boolean;
  environment: QboEnvironment | null;
  realmId: string | null;
  companyName: string | null;
  connectedAt: string | null;
}

export async function getConnectionStatus(): Promise<QboConnectionStatus> {
  const cfg = getQboConfig();
  if (!cfg) {
    return {
      configured: false,
      connected: false,
      environment: null,
      realmId: null,
      companyName: null,
      connectedAt: null,
    };
  }

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("quickbooks_connection")
      .select("realm_id, environment, company_name, connected_at")
      .eq("id", true)
      .maybeSingle();

    return {
      configured: true,
      connected: Boolean(data),
      environment: cfg.environment,
      realmId: data?.realm_id ?? null,
      companyName: data?.company_name ?? null,
      connectedAt: data?.connected_at ?? null,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      environment: cfg.environment,
      realmId: null,
      companyName: null,
      connectedAt: null,
    };
  }
}

/**
 * Exchange an OAuth authorization code for tokens and persist the connection.
 * Called from the OAuth callback route after admin verification.
 */
export async function exchangeAndStore(
  code: string,
  realmId: string,
  connectedBy: string | null
): Promise<void> {
  const cfg = getQboConfig();
  if (!cfg) throw new Error("QuickBooks is not configured on this server.");

  const tokens = await requestTokens(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });

  const now = Date.now();
  const admin = createAdminClient();
  await admin.from("quickbooks_connection").upsert(
    {
      id: true,
      realm_id: realmId,
      access_token: encryptToken(tokens.access_token, cfg.tokenSecret),
      refresh_token: encryptToken(tokens.refresh_token, cfg.tokenSecret),
      token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(
        now + tokens.x_refresh_token_expires_in * 1000
      ).toISOString(),
      environment: cfg.environment,
      connected_by: connectedBy,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
}

export interface ActiveConnection {
  accessToken: string;
  realmId: string;
  environment: QboEnvironment;
}

// Refresh when the access token has under this many seconds of life left.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Return a valid access token + realm, refreshing if the current token is
 * expired or close to it. Throws if QBO isn't connected — callers treat this
 * as a recoverable, retryable condition (the approval is never reversed).
 */
export async function getActiveConnection(): Promise<ActiveConnection> {
  const cfg = getQboConfig();
  if (!cfg) throw new Error("QuickBooks is not configured on this server.");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("quickbooks_connection")
    .select("realm_id, access_token, refresh_token, token_expires_at, environment")
    .eq("id", true)
    .maybeSingle();

  if (!row) throw new Error("QuickBooks is not connected. Connect it in Settings → Integrations.");

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return {
      accessToken: decryptToken(row.access_token, cfg.tokenSecret),
      realmId: row.realm_id,
      environment: (row.environment as QboEnvironment) ?? cfg.environment,
    };
  }

  // Refresh the access token using the stored refresh token.
  const refreshToken = decryptToken(row.refresh_token, cfg.tokenSecret);
  const tokens = await requestTokens(cfg, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const now = Date.now();
  await admin
    .from("quickbooks_connection")
    .update({
      access_token: encryptToken(tokens.access_token, cfg.tokenSecret),
      // Intuit rotates the refresh token periodically; always store the latest.
      refresh_token: encryptToken(tokens.refresh_token, cfg.tokenSecret),
      token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(
        now + tokens.x_refresh_token_expires_in * 1000
      ).toISOString(),
    })
    .eq("id", true);

  return {
    accessToken: tokens.access_token,
    realmId: row.realm_id,
    environment: (row.environment as QboEnvironment) ?? cfg.environment,
  };
}
