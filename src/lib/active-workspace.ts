/**
 * Active-workspace resolution (Membership S3). Pure, no I/O.
 *
 * Two SEPARATE concepts, never mixed:
 *   • AUTHORIZATION — "may this user access Client X?" — answered by
 *     client_members / is_client_member() and enforced by Postgres RLS (S2).
 *   • ACTIVE WORKSPACE — "which authorized client is the portal displaying?" —
 *     answered here (S3). The active workspace is PRESENTATION context only. It
 *     NEVER grants access: a user can only activate a workspace they already
 *     have a membership to, and the stored preference is validated against real
 *     memberships on EVERY resolution.
 *
 * The stored value (a cookie) is only a REQUEST/preference — it is never trusted
 * as authorization. A tampered or stale value that isn't a current membership is
 * discarded and a deterministic fallback is chosen instead.
 */

/** Cookie that stores the client's requested active workspace (a preference). */
export const ACTIVE_WORKSPACE_COOKIE = "bbettr_active_workspace";

export type ActiveWorkspaceSource =
  | "stored" // a valid stored preference matched a membership
  | "legacy_default" // fell back to profiles.client_id (existing clients: unchanged)
  | "fallback" // deterministic pick from memberships
  | "none"; // no memberships → caller must fail safe

export interface ActiveWorkspaceResolution {
  activeClientId: string | null;
  source: ActiveWorkspaceSource;
}

export interface ResolveActiveWorkspaceInput {
  /** The client_ids this user is genuinely a member of (from client_members). */
  memberships: readonly string[];
  /** profiles.client_id — the legacy/default workspace (may be null). */
  legacyClientId: string | null;
  /** The requested workspace from the cookie (untrusted preference), or null. */
  stored: string | null;
}

/**
 * Resolve which authorized workspace to display. Deterministic and safe:
 *   1. zero memberships                  → null (caller fails safe; never guesses)
 *   2. a valid stored preference (member) → that workspace
 *   3. else the legacy default if still a member → that (existing clients: no change)
 *   4. else a deterministic fallback: the lowest client_id among memberships
 *      (explicit ordering — NEVER arbitrary database row order)
 *
 * Authorization is NOT considered here beyond the membership set the caller
 * supplies; RLS remains the enforcement boundary.
 */
export function resolveActiveWorkspace(
  input: ResolveActiveWorkspaceInput
): ActiveWorkspaceResolution {
  const memberships = input.memberships;
  if (memberships.length === 0) return { activeClientId: null, source: "none" };

  const set = new Set(memberships);

  if (input.stored && set.has(input.stored)) {
    return { activeClientId: input.stored, source: "stored" };
  }
  if (input.legacyClientId && set.has(input.legacyClientId)) {
    return { activeClientId: input.legacyClientId, source: "legacy_default" };
  }
  // Deterministic fallback — lowest id by stable string ordering.
  const fallback = [...memberships].sort()[0];
  return { activeClientId: fallback, source: "fallback" };
}

/**
 * Whether a workspace may be ACTIVATED by this user — i.e. it is one of their
 * memberships. This is a presentation gate; the database (RLS) is still the
 * authorization boundary. Never activates a non-member workspace.
 */
export function canActivateWorkspace(
  clientId: string,
  memberships: readonly string[]
): boolean {
  return memberships.includes(clientId);
}

/**
 * Guard for a post-set return path to prevent open redirects: only same-origin
 * ABSOLUTE paths (one leading slash, no scheme, no protocol-relative "//", no
 * backslash tricks). Anything else falls back to the default destination.
 */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    !path.includes("://")
  );
}
