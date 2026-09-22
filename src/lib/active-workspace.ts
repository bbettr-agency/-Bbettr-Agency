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

/**
 * The client portal's workspace-agnostic routes: their URLs carry NO entity id,
 * so the same path is valid in every workspace. Keeping the user here after a
 * switch can never 404 or leak cross-tenant existence.
 */
export const SAFE_CLIENT_ROUTES: ReadonlySet<string> = new Set([
  "/dashboard",
  "/dashboard/onboarding",
  "/dashboard/project",
  "/dashboard/updates",
  "/dashboard/reports",
  "/dashboard/files",
  "/dashboard/invoices",
  "/dashboard/contracts",
]);

/**
 * Where to land after switching workspace (S4B). Keep the user on their current
 * route when it's a known workspace-agnostic client route; otherwise fall back
 * to the dashboard. This means an unexpected/nested/entity route (none exist
 * today, but future-proofed) redirects to a safe parent rather than a path that
 * may not exist in the target workspace.
 */
export function safeSwitchReturnPath(pathname: string | null | undefined): string {
  const path = (pathname ?? "").split("?")[0].split("#")[0];
  return SAFE_CLIENT_ROUTES.has(path) ? path : "/dashboard";
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface WorkspaceMenu {
  /** Display name of the active workspace, or null if it isn't in the list. */
  activeName: string | null;
  /** Workspaces sorted by name, each flagged with whether it's active. */
  options: (WorkspaceOption & { isActive: boolean })[];
}

/**
 * Build the switcher's view model from the active workspace id and the user's
 * workspaces. Pure and deterministic (name-sorted), so the UI never shows a UUID
 * and the active workspace is unambiguous.
 */
export function buildWorkspaceMenu(
  activeId: string,
  workspaces: readonly WorkspaceOption[]
): WorkspaceMenu {
  const options = [...workspaces]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((w) => ({ ...w, isActive: w.id === activeId }));
  return { activeName: options.find((o) => o.isActive)?.name ?? null, options };
}
