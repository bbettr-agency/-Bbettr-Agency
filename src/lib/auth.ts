import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";

/**
 * Returns the authenticated user's profile (role + tenant binding), or null.
 * Server-only.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
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
}

/** Require any authenticated session; redirect to /login otherwise. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Require an admin session; redirect non-admins to their client dashboard. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/dashboard");
  return profile;
}

/** Require a client session bound to a tenant; redirect admins to admin area. */
export async function requireClient(): Promise<Profile & { client_id: string }> {
  const profile = await requireProfile();
  if (profile.role === "admin") redirect("/admin");
  if (!profile.client_id) {
    // Client profile without a tenant binding is misconfigured.
    redirect("/login?error=no_client");
  }
  return profile as Profile & { client_id: string };
}
