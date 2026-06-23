import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";

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
