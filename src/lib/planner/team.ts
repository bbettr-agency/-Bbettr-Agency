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

/**
 * List the workspace's admin team.
 *
 * The workspace is resolved via `current_workspace_id()` UNLESS the caller passes
 * one it already holds — callers that have already loaded the acting admin's
 * profile (e.g. Team View, which calls getCurrentProfile for its auth gate) should
 * pass `profile.workspace_id` to avoid a redundant RPC round-trip and keep team
 * resolution to a single query. Passing an explicit `null` means "no workspace" →
 * fail-closed to an empty team.
 */
export async function listAdminTeam(workspaceId?: string | null): Promise<TeamMemberLite[]> {
  const supabase = await createClient();

  const wsId =
    workspaceId !== undefined ? workspaceId : (await supabase.rpc("current_workspace_id")).data;
  if (!wsId) return []; // fail-closed: no resolved workspace → no members

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "admin")
    .eq("workspace_id", wsId)
    .order("full_name", { ascending: true });

  return (data ?? []).map((p) => ({ id: p.id, fullName: p.full_name ?? "Admin" }));
}
