import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The Planner team = Portal admin profiles IN THE CURRENT WORKSPACE. One batched
 * read (admins can read all profiles under RLS). Also serves meeting owner-name
 * resolution, since a meeting's created_by is always an admin — so no separate
 * owner query / N+1.
 *
 * Workspace correctness: admins are resolved via `current_workspace_id()` (the
 * same fail-closed SECURITY DEFINER resolver every task-domain RLS policy uses)
 * so the team list can never drift from the workspace-scoped task reads. When the
 * caller has no resolved workspace, the team is empty (fail-closed). This is an
 * authenticated, RLS-safe server read — no service-role client is used.
 */
export interface TeamMemberLite {
  id: string;
  fullName: string;
}

export async function listAdminTeam(): Promise<TeamMemberLite[]> {
  const supabase = await createClient();

  // Resolve the acting admin's workspace (fail-closed: null → no members).
  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "admin")
    .eq("workspace_id", workspaceId)
    .order("full_name", { ascending: true });

  return (data ?? []).map((p) => ({ id: p.id, fullName: p.full_name ?? "Admin" }));
}
