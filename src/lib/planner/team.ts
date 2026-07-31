import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The Planner team = Portal admin profiles. One batched read (admins can read
 * all profiles under RLS). Also serves meeting owner-name resolution, since a
 * meeting's created_by is always an admin — so no separate owner query / N+1.
 */
export interface TeamMemberLite {
  id: string;
  fullName: string;
}

export async function listAdminTeam(): Promise<TeamMemberLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "admin")
    .order("full_name", { ascending: true });
  return (data ?? []).map((p) => ({ id: p.id, fullName: p.full_name ?? "Admin" }));
}
