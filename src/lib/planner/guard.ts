import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import type { Profile } from "@/lib/database.types";

/**
 * Server-side authorization for every Planner route. `requireAdmin` redirects
 * non-admins (clients/reps never reach a Planner page); when the module is off,
 * the route 404s. Defense-in-depth on top of the (admin) layout guard — a
 * Planner URL cannot be accessed directly without admin permissions.
 */
export async function requirePlannerAccess(): Promise<Profile> {
  const profile = await requireAdmin();
  if (!PLANNER_ENABLED) notFound();
  return profile;
}
