import "server-only";
import { IntegrationAuthError } from "@/lib/net";
import type { GoogleConfig } from "./config";

/**
 * Google account-identity policy — the single place that decides "did the RIGHT
 * account consent?".
 *
 * This is deliberately isolated so account verification has one responsibility
 * and one future extension point: to allow a domain allowlist, several approved
 * accounts, or verification via the userinfo endpoint instead of the id_token,
 * change ONLY this module. Nothing else in the Google integration compares
 * account identity.
 */

const INTEGRATION = "google";

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
 * Verify the account that just consented is the expected shared agency account,
 * and return the verified account email to persist (or null if the id_token
 * carried no email and identity could not be confirmed — the caller then falls
 * back to the configured address).
 *
 * Policy today: exact, case-insensitive match against `cfg.calendarId`. On a
 * definite mismatch it throws a terminal auth error coded "wrong_account"; a
 * missing/undecodable email does NOT block connecting.
 */
export function verifyConsentAccount(
  idToken: string | undefined,
  cfg: GoogleConfig
): string | null {
  const email = emailFromIdToken(idToken);
  if (email && email !== cfg.calendarId.toLowerCase()) {
    throw new IntegrationAuthError(
      INTEGRATION,
      "A different Google account was used than the configured shared calendar.",
      "wrong_account"
    );
  }
  return email;
}
