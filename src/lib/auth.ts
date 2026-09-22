import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";
import {
  ACTIVE_WORKSPACE_COOKIE,
  resolveActiveWorkspace,
} from "@/lib/active-workspace";

/**
 * Returns the authenticated user's profile (role + tenant binding), or null.
 * Server-only.
 *
 * Wrapped in React `cache()` so repeated calls within a single request (e.g. a
 * layout and its page both calling requireClient) reuse one auth + profile
 * lookup instead of re-querying. Auth logic and permissions are unchanged.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile ?? null;
});

/** Require any authenticated session; redirect to /login otherwise. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** The home surface for each role. */
export function homePath(role: Profile["role"]): string {
  if (role === "admin") return "/admin";
  if (role === "rep") return "/rep";
  return "/dashboard";
}

/** Require an admin session; redirect non-admins to their own home. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect(homePath(profile.role));
  return profile;
}

/** Require a client session bound to a tenant; redirect others to their home. */
export async function requireClient(): Promise<Profile & { client_id: string }> {
  const profile = await requireProfile();
  if (profile.role !== "client") redirect(homePath(profile.role));
  if (!profile.client_id) {
    // Client profile without a tenant binding is misconfigured.
    redirect("/login?error=no_client");
  }
  return profile as Profile & { client_id: string };
}

/**
 * The resolved active-workspace context for a client session (Membership S3).
 *
 * `clientId` is the ACTIVE workspace the portal should display — the ONE value
 * every client-facing tenant query must scope to, so a multi-workspace user
 * never sees Overview=B while Files=A. It is resolved deterministically from the
 * user's real memberships, their stored preference (validated every time), and
 * their legacy default; it never grants access (S2 RLS remains the boundary).
 */
export interface ClientWorkspaceContext {
  profile: Profile;
  /** Active workspace id — use THIS for all client tenant queries/writes. */
  clientId: string;
  /** Every workspace this user is a member of (their own rows, via RLS). */
  memberships: string[];
  /** True when the user belongs to more than one workspace (S4 switcher). */
  hasMultiple: boolean;
}

/**
 * Require a client session and resolve its active workspace (S3). Admins/reps
 * are redirected to their own home (admin authorization is never routed through
 * membership). A client with ZERO memberships fails safe to /login?error=
 * no_client — no unrelated workspace is ever guessed. Reads client_members under
 * the caller's RLS, so only the user's own memberships are visible.
 *
 * Drop-in replacement for requireClient() on client surfaces: use `clientId`
 * (active workspace) wherever `profile.client_id` (legacy) was used before.
 */
export async function requireClientWorkspace(): Promise<ClientWorkspaceContext> {
  const profile = await requireProfile();
  if (profile.role !== "client") redirect(homePath(profile.role));

  const supabase = await createClient();
  const { data } = await supabase.from("client_members").select("client_id");
  const memberships = (data ?? []).map((r) => r.client_id as string);

  const cookieStore = await cookies();
  const stored = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;

  const { activeClientId } = resolveActiveWorkspace({
    memberships,
    legacyClientId: profile.client_id ?? null,
    stored,
  });
  if (!activeClientId) {
    // Client-role user with no workspace membership is misconfigured.
    redirect("/login?error=no_client");
  }

  return {
    profile,
    clientId: activeClientId,
    memberships,
    hasMultiple: memberships.length > 1,
  };
}

/** Require a sales-rep session; redirect others to their own home. */
export async function requireRep(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "rep") redirect(homePath(profile.role));
  return profile;
}

/**
 * Whether a rep's account is currently active. Deactivating a rep
 * (`reps.active = false`) must block portal use, not just hide them from lists.
 * A `rep`-role user with no `reps` row is treated as inactive (misconfigured).
 * Returns false on any read error so a failure can't silently grant access.
 */
export async function isRepActive(repId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("reps")
      .select("active")
      .eq("id", repId)
      .maybeSingle();
    return data?.active === true;
  } catch {
    return false;
  }
}
