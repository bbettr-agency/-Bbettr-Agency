import "server-only";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
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
