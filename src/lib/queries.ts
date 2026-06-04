import { createClient } from "@/lib/supabase/server";

/**
 * Tenant-scoped data access helpers. RLS guarantees a client can only ever
 * read its own rows, but we still filter by client_id explicitly for clarity
 * and so admins can reuse these helpers for a specific tenant.
 */

/** Portal sections that carry notification dots, mapped to their nav href. */
export const NOTIFY_SECTIONS = ["project", "updates", "reports", "files"] as const;
export type NotifySection = (typeof NOTIFY_SECTIONS)[number];

export const SECTION_HREF: Record<NotifySection, string> = {
  project: "/dashboard/project",
  updates: "/dashboard/updates",
  reports: "/dashboard/reports",
  files: "/dashboard/files",
};

export type ClientNotifications = Record<NotifySection, boolean>;

/**
 * Compute which portal sections have unseen activity for a client: the section
 * has a dot when its most recent activity is newer than the client's last view
 * of that section. `currentUserId` is excluded from "files" so a client's own
 * uploads never notify themselves (admin-side uploads still do).
 *
 * Runs entirely under the client's RLS — no service role needed.
 */
export async function getClientNotifications(
  clientId: string,
  currentUserId: string
): Promise<ClientNotifications> {
  const supabase = await createClient();

  const [stages, updates, reports, files, views] = await Promise.all([
    supabase
      .from("project_stages")
      .select("updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("updates")
      .select("published_at")
      .eq("client_id", clientId)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("reports")
      .select("created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("files")
      .select("created_at, uploaded_by")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("client_section_views")
      .select("section, last_viewed_at")
      .eq("client_id", clientId),
  ]);

  const viewedAt = new Map(
    (views.data ?? []).map((v) => [v.section, v.last_viewed_at])
  );

  const isUnread = (section: NotifySection, activityTs?: string | null) => {
    if (!activityTs) return false;
    const seen = viewedAt.get(section);
    return !seen || new Date(activityTs) > new Date(seen);
  };

  // Most recent file not uploaded by the current client user.
  const latestForeignFile = (files.data ?? []).find(
    (f) => f.uploaded_by !== currentUserId
  );

  return {
    project: isUnread("project", stages.data?.[0]?.updated_at),
    updates: isUnread("updates", updates.data?.[0]?.published_at),
    reports: isUnread("reports", reports.data?.[0]?.created_at),
    files: isUnread("files", latestForeignFile?.created_at),
  };
}

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

/**
 * Onboarding is complete once every purchased service has been submitted or
 * approved. (Submitted is the terminal state in the client flow; approved is an
 * optional admin step.)
 */
export function isOnboardingComplete(
  services: { onboarding_status: string }[]
): boolean {
  return (
    services.length > 0 &&
    services.every(
      (s) =>
        s.onboarding_status === "submitted" ||
        s.onboarding_status === "approved"
    )
  );
}

/**
 * Derive the current project phase from the roadmap — the single source of
 * truth for "where the project is". Returns the in-progress stage if there is
 * one, otherwise the first pending stage, otherwise the last completed stage
 * (i.e. "Launched"). Used for the client hero so it never contradicts the
 * progress bar.
 */
export function currentPhase(
  stages: { name: string; status: string; position: number }[]
): { label: string; state: "completed" | "in_progress" | "pending" } | null {
  if (stages.length === 0) return null;
  const ordered = [...stages].sort((a, b) => a.position - b.position);

  const active = ordered.find((s) => s.status === "in_progress");
  if (active) return { label: active.name, state: "in_progress" };

  const pending = ordered.find((s) => s.status === "pending");
  if (pending) return { label: pending.name, state: "pending" };

  // Everything is complete.
  const last = ordered[ordered.length - 1];
  return { label: `${last.name} — Complete`, state: "completed" };
}

