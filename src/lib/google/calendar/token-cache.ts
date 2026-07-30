import "server-only";
import { getAccessToken } from "@/lib/google/connection";

/**
 * Provider-local in-memory access-token cache (Phase 3.1 hardening).
 *
 * The shared agency account has one access token at a time, so a module-level
 * cache lets every calendar operation reuse it instead of minting a fresh token
 * (a Google token-endpoint round trip) on each call. We refresh only when the
 * token is within a 5-minute safety window of expiry.
 *
 * Refresh-token behaviour is unchanged: on a cache miss we call getAccessToken,
 * which still handles refresh, rotation, and invalid_grant → reconnect_required.
 * This module changes no public interface — it wraps the existing call.
 *
 * Serverless note: each server instance keeps its own cache; that is fine — the
 * worst case is one refresh per instance per ~55 minutes.
 */

const SKEW_MS = 5 * 60 * 1000;

let cache: { token: string; expiresAtMs: number } | null = null;

/** Return a valid access token, refreshing only when close to expiry. */
export async function getCachedAccessToken(correlationId?: string): Promise<string> {
  const now = Date.now();
  if (cache && now < cache.expiresAtMs - SKEW_MS) {
    return cache.token;
  }
  const { accessToken, expiresInSec } = await getAccessToken(correlationId);
  cache = { token: accessToken, expiresAtMs: now + expiresInSec * 1000 };
  return accessToken;
}

/**
 * Drop the cached token so the next call refreshes. Called after a 401/403 from
 * the API (a token revoked mid-window), and exposed for tests.
 */
export function invalidateAccessTokenCache(): void {
  cache = null;
}
