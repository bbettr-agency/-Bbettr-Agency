import { createClient } from "@/lib/supabase/server";

/**
 * Tenant-scoped data access helpers. RLS guarantees a client can only ever
 * read its own rows, but we still filter by client_id explicitly for clarity
 * and so admins can reuse these helpers for a specific tenant.
 */

export async function getClient(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();
  return data;
}

export async function getClientServices(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_services")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at");
  return data ?? [];
}

export async function getProjectStages(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_stages")
    .select("*")
    .eq("client_id", clientId)
    .order("position");
  return data ?? [];
}

export async function getUpdates(clientId: string, limit?: number) {
  const supabase = await createClient();
  let query = supabase
    .from("updates")
    .select("*")
    .eq("client_id", clientId)
    .order("published_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data } = await query;
  return data ?? [];
}

export async function getReports(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .order("reporting_month", { ascending: false });
  return data ?? [];
}

export async function getFiles(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("files")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getOnboarding(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("onboarding_submissions")
    .select("*")
    .eq("client_id", clientId);
  return data ?? [];
}

/** Percentage of project stages completed (0–100). */
export function computeProgress(
  stages: { status: string }[]
): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "completed").length;
  const inProgress = stages.filter((s) => s.status === "in_progress").length;
  return Math.round(((done + inProgress * 0.5) / stages.length) * 100);
}
