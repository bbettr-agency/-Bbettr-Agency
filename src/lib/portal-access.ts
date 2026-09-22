/**
 * Admin Portal Access — pure helpers (Membership S4A). No I/O.
 *
 * Bbettr admins control WHO can access each client workspace by managing
 * `client_members` rows (S1). A portal USER (auth.users) is not a workspace: one
 * user may belong to many client workspaces. Granting access to a second
 * workspace NEVER creates a second auth account and NEVER changes the user's
 * password or existing default workspace.
 *
 * These helpers hold the deterministic, side-effect-free decisions the server
 * actions rely on, so they can be unit-tested in isolation.
 */

/** Normalise an email for lookup/dedup: trimmed + lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Minimal, conservative email validation (a real address is verified by Auth). */
export function isValidEmail(email: string): boolean {
  const e = email.trim();
  // one @, non-empty local part, a dot-bearing domain, no whitespace.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export type MemberAccessStatus = "active" | "invited";

/**
 * A member always has an auth user (membership implies one). They are "active"
 * once they've signed in at least once, otherwise "invited" (account exists, the
 * invitation/first login is still pending).
 */
export function memberAccessStatus(lastSignInAt: string | null): MemberAccessStatus {
  return lastSignInAt ? "active" : "invited";
}

export interface RevokeDefaultDecision {
  /** The value profiles.client_id should hold after the revoke. */
  newDefault: string | null;
  /** Whether the legacy/default workspace actually needs to change. */
  changed: boolean;
}

/**
 * Decide the user's legacy/default workspace (profiles.client_id) after a
 * membership is revoked, keeping S3's default coherent:
 *   - revoking a NON-default workspace changes nothing;
 *   - revoking the DEFAULT while other memberships remain → the deterministic
 *     lowest remaining id (matches S3's fallback ordering);
 *   - revoking the LAST membership → null.
 * `remainingMemberships` are the client_ids left AFTER the revoke.
 */
export function decideDefaultAfterRevoke(input: {
  currentDefault: string | null;
  revokedClientId: string;
  remainingMemberships: readonly string[];
}): RevokeDefaultDecision {
  if (input.currentDefault !== input.revokedClientId) {
    return { newDefault: input.currentDefault, changed: false };
  }
  const next =
    input.remainingMemberships.length > 0
      ? [...input.remainingMemberships].sort()[0]
      : null;
  return { newDefault: next, changed: true };
}

export type GrantOutcome =
  | "granted" // membership newly created for an existing (healthy) user
  | "repaired" // an existing Auth identity with an incomplete/missing profile
  // was repaired (profile + default filled) and given the membership
  | "already_member" // idempotent: the membership already existed
  | "invited"; // a new user was invited and given the membership

/** Result surfaced to the admin UI after a grant attempt. */
export interface GrantResult {
  ok: boolean;
  outcome?: GrantOutcome;
  email?: string;
  error?: string;
}
