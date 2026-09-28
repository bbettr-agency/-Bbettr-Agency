import "server-only";

import { redirect } from "next/navigation";
import { requireAdmin, getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveEffectiveGrants } from "./grants";
import { GRANT_JARVIS_USE } from "./constants";

/**
 * The resolved Jarvis execution context for an authenticated principal.
 * `principalId` is the HUMAN's authority; `grants` are their effective grants;
 * `workspaceId` is the agency workspace. The Jarvis system actor is provenance
 * only and never appears here as authority.
 */
export interface JarvisContext {
  principalId: string;
  workspaceId: string;
  grants: Set<string>;
}

export type JarvisResolution = JarvisContext | { denied: "no_workspace" | "not_enabled" };

/**
 * Non-redirecting resolver (testable / branchable). Enforces, in order:
 *   1. authenticated ADMIN (requireAdmin redirects clients/reps — V1 route gate);
 *   2. agency workspace resolvable via the fail-closed current_workspace_id();
 *   3. principal holds the 'jarvis.use' grant (Jarvis-enabled).
 * Anything missing ⇒ denied. (The capability MODEL does not require role=admin;
 * only the V1 route gate does — future staff can hold grants without being admin.)
 */
export async function resolveJarvisContext(): Promise<JarvisResolution> {
  const profile = await requireAdmin(); // redirects non-admins to their home
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_workspace_id");
  const workspaceId = (data as string | null) ?? null;
  if (!workspaceId) return { denied: "no_workspace" };
  const grants = await resolveEffectiveGrants(profile.id, workspaceId);
  if (!grants.has(GRANT_JARVIS_USE)) return { denied: "not_enabled" };
  return { principalId: profile.id, workspaceId, grants };
}

/** Require a fully-authorised Jarvis principal or redirect (fail-closed). */
export async function requireJarvisUser(): Promise<JarvisContext> {
  const ctx = await resolveJarvisContext();
  if ("denied" in ctx) redirect("/admin?error=jarvis_unavailable");
  return ctx;
}

/** Denial reasons for the API-safe resolver — richer than the page resolver's set
 *  so a JSON route can map each to a distinct HTTP status without ever redirecting. */
export type JarvisApiDenial =
  | { denied: "unauthenticated" } // no session
  | { denied: "forbidden_role" } // authenticated, but not the V1 internal (admin) gate
  | { denied: "no_workspace" } // admin without a resolvable agency workspace
  | { denied: "not_enabled" }; // admin+workspace but lacking the jarvis.use grant

/**
 * API-SAFE Jarvis context resolver (server-only, NEVER redirects). Intended for
 * Route Handlers, where the page-oriented `resolveJarvisContext` (which calls
 * `requireAdmin` → `redirect`) is unusable. Enforces the SAME trusted model as the
 * page path, in order:
 *   1. authenticated session (getCurrentProfile, non-redirecting) — else unauthenticated;
 *   2. V1 internal eligibility: role === 'admin' — else forbidden_role (Portal role is
 *      the route gate, NOT Jarvis authority);
 *   3. agency workspace via the fail-closed current_workspace_id() — else no_workspace;
 *   4. effective grants include 'jarvis.use' — else not_enabled.
 * Returns the SAME trusted JarvisContext shape as the page resolver. Workspace/user
 * are always derived server-side; nothing here is ever taken from HTTP input, and the
 * service role is never used to bypass the grant model.
 */
export async function resolveJarvisContextApi(): Promise<JarvisContext | JarvisApiDenial> {
  const profile = await getCurrentProfile(); // returns null (never redirects)
  if (!profile) return { denied: "unauthenticated" };
  if (profile.role !== "admin") return { denied: "forbidden_role" };
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_workspace_id");
  const workspaceId = (data as string | null) ?? null;
  if (!workspaceId) return { denied: "no_workspace" };
  const grants = await resolveEffectiveGrants(profile.id, workspaceId);
  if (!grants.has(GRANT_JARVIS_USE)) return { denied: "not_enabled" };
  return { principalId: profile.id, workspaceId, grants };
}
