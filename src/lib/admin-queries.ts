import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Client,
  ClientService,
  ProjectStage,
} from "@/lib/database.types";

export interface PortalAccess {
  email: string | null;
  hasLogin: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
}

/**
 * Portal access + login activity for a client. Reads the client's auth login
 * via the service-role admin API (last_sign_in_at / created_at are not stored
 * in `profiles`). Admin-only; call from admin pages.
 */
export async function getPortalAccess(clientId: string): Promise<PortalAccess> {
  const supabase = await createClient();
  const [{ data: client }, { data: profiles }] = await Promise.all([
    supabase.from("clients").select("contact_email").eq("id", clientId).single(),
    supabase.from("profiles").select("id, email").eq("client_id", clientId).limit(1),
  ]);

  const profile = profiles?.[0];
  let hasLogin = false;
  let lastSignInAt: string | null = null;
  let createdAt: string | null = null;

  if (profile) {
    try {
      const admin = createAdminClient();
      const { data } = await admin.auth.admin.getUserById(profile.id);
      if (data.user) {
        hasLogin = true;
        lastSignInAt = data.user.last_sign_in_at ?? null;
        createdAt = data.user.created_at ?? null;
      }
    } catch {
      // Service role unavailable — fall back to "no login info".
    }
  }

  return {
    email: client?.contact_email ?? profile?.email ?? null,
    hasLogin,
    lastSignInAt,
    createdAt,
  };
}

/** Aggregated shape used by the admin client list. */
export interface ClientSummary extends Client {
  services: ClientService["service"][];
  onboarding_done: number;
  onboarding_total: number;
  stages: Pick<ProjectStage, "status">[];
  last_update: string | null;
  last_report: string | null;
}

export async function getAllClients(): Promise<ClientSummary[]> {
  const supabase = await createClient();

  const [{ data: clients }, { data: services }, { data: stages }, { data: updates }, { data: reports }] =
    await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: false }),
      supabase.from("client_services").select("client_id, service, onboarding_status"),
      supabase.from("project_stages").select("client_id, status"),
      supabase.from("updates").select("client_id, published_at").order("published_at", { ascending: false }),
      supabase.from("reports").select("client_id, reporting_month").order("reporting_month", { ascending: false }),
    ]);

  return (clients ?? []).map((c) => {
    const svc = (services ?? []).filter((s) => s.client_id === c.id);
    return {
      ...c,
      services: svc.map((s) => s.service),
      onboarding_done: svc.filter(
        (s) => s.onboarding_status === "submitted" || s.onboarding_status === "approved"
      ).length,
      onboarding_total: svc.length,
      stages: (stages ?? []).filter((s) => s.client_id === c.id),
      last_update:
        (updates ?? []).find((u) => u.client_id === c.id)?.published_at ?? null,
      last_report:
        (reports ?? []).find((r) => r.client_id === c.id)?.reporting_month ?? null,
    };
  });
}

export interface AdminStats {
  totalClients: number;
  activeProjects: number;
  pendingOnboardings: number;
  totalReports: number;
  totalFiles: number;
  recentUpdates: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const supabase = await createClient();
  const [clients, activeProjects, pendingOnboarding, reports, files, updates] =
    await Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .in("status", ["in_progress", "active"]),
      supabase
        .from("client_services")
        .select("id", { count: "exact", head: true })
        .in("onboarding_status", ["not_started", "in_progress"]),
      supabase.from("reports").select("id", { count: "exact", head: true }),
      supabase.from("files").select("id", { count: "exact", head: true }),
      supabase.from("updates").select("id", { count: "exact", head: true }),
    ]);

  return {
    totalClients: clients.count ?? 0,
    activeProjects: activeProjects.count ?? 0,
    pendingOnboardings: pendingOnboarding.count ?? 0,
    totalReports: reports.count ?? 0,
    totalFiles: files.count ?? 0,
    recentUpdates: updates.count ?? 0,
  };
}

/** Recent updates across all tenants, joined with the client name. */
export async function getRecentUpdatesGlobal(limit = 6) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("updates")
    .select("id, title, body, published_at, client_id, clients(name)")
    .order("published_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** All reports across all tenants, joined with the client name. */
export async function getAllReportsGlobal() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*, clients(name)")
    .order("reporting_month", { ascending: false });
  return data ?? [];
}

/** All files across all tenants, joined with the client name. */
export async function getAllFilesGlobal() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("files")
    .select("*, clients(name)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** All invoice requests (newest first) with their deal details, for the admin queue. */
export async function getInvoiceRequests() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoice_requests")
    .select(
      "id, amount, billing_type, status, created_at, deal_id, rep_id, deals(business_name, contact_name, email, package)"
    )
    .order("created_at", { ascending: false });
  return data ?? [];
}
