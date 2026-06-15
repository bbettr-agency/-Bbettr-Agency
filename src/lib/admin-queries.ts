import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Client,
  ClientService,
  ProjectStage,
} from "@/lib/database.types";

/** All team members (Success Managers), default first. Admin-only. */
export async function getTeamMembers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("id, name, role, is_default")
    .order("is_default", { ascending: false })
    .order("name");
  return data ?? [];
}

/** Full activity timeline for a client (incl. internal events). Admin view. */
export async function getClientActivity(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_events")
    .select("id, type, title, description, visibility, occurred_at, source")
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: false });
  return data ?? [];
}

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
export interface PayfastSummary {
  status: string;
  payment_url: string;
  paid_at: string | null;
}

export async function getInvoiceRequests() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoice_requests")
    .select(
      "id, amount, billing_type, status, created_at, deal_id, rep_id, quickbooks_invoice_number, quickbooks_invoice_id, quickbooks_customer_id, quickbooks_realm_id, quickbooks_email_status, quickbooks_emailed_at, quickbooks_last_attempt_at, invoiced_at, error, deals(business_name, contact_name, email, package, client_location, has_monthly_retainer, monthly_retainer_name, monthly_retainer_amount)"
    )
    .order("created_at", { ascending: false });
  const requests = data ?? [];

  // Attach the PayFast payment (international only). Separate fetch + merge keeps
  // the typed select simple; SA requests have no row → payfast stays null.
  const { data: payments } = await supabase
    .from("payfast_payments")
    .select("invoice_request_id, status, payment_url, paid_at");
  const byRequest = new Map(
    (payments ?? []).map((p) => [
      p.invoice_request_id,
      { status: p.status, payment_url: p.payment_url, paid_at: p.paid_at } as PayfastSummary,
    ])
  );

  return requests.map((r) => ({
    ...r,
    payfast: byRequest.get(r.id) ?? null,
  }));
}

export interface RepSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  commissionRate: number;
  active: boolean;
  dealsCount: number;
  pendingRequests: number;
  approvedRequests: number;
  salesValue: number;
  commissionTotal: number;
}

/** All reps with aggregated deal/commission stats, for the admin Reps list. */
export async function getAllReps(): Promise<RepSummary[]> {
  const supabase = await createClient();
  const [{ data: reps }, { data: profiles }, { data: deals }, { data: requests }, { data: commissions }] =
    await Promise.all([
      supabase.from("reps").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email").eq("role", "rep"),
      supabase.from("deals").select("rep_id, price"),
      supabase.from("invoice_requests").select("rep_id, status"),
      supabase.from("commissions").select("rep_id, amount"),
    ]);

  return (reps ?? []).map((r) => {
    const profile = (profiles ?? []).find((p) => p.id === r.id);
    const repRequests = (requests ?? []).filter((x) => x.rep_id === r.id);
    const repDeals = (deals ?? []).filter((d) => d.rep_id === r.id);
    return {
      id: r.id,
      name: profile?.full_name || r.display_name || "Rep",
      email: profile?.email ?? null,
      phone: r.phone,
      commissionRate: Number(r.commission_rate),
      active: r.active,
      dealsCount: repDeals.length,
      pendingRequests: repRequests.filter((x) => x.status === "pending").length,
      approvedRequests: repRequests.filter(
        (x) => x.status === "approved" || x.status === "invoiced"
      ).length,
      salesValue: repDeals.reduce((s, d) => s + Number(d.price || 0), 0),
      commissionTotal: (commissions ?? [])
        .filter((c) => c.rep_id === r.id)
        .reduce((s, c) => s + Number(c.amount || 0), 0),
    };
  });
}

/** A rep's deal annotated with its invoice-request status (for admin display). */
export type RepDetailDeal = import("@/lib/database.types").Deal & {
  requestStatus: import("@/lib/database.types").InvoiceRequestStatus;
};

export interface RepDetail extends RepSummary {
  lastSignInAt: string | null;
  createdAt: string | null;
  deals: RepDetailDeal[];
}

/** Full rep detail for the admin rep page (profile, login activity, deals). */
export async function getRepDetail(repId: string): Promise<RepDetail | null> {
  const supabase = await createClient();
  const [{ data: rep }, { data: profile }, { data: deals }, { data: requests }, { data: commissions }] =
    await Promise.all([
      supabase.from("reps").select("*").eq("id", repId).maybeSingle(),
      supabase.from("profiles").select("full_name, email").eq("id", repId).maybeSingle(),
      supabase.from("deals").select("*").eq("rep_id", repId).order("created_at", { ascending: false }),
      supabase.from("invoice_requests").select("deal_id, status").eq("rep_id", repId),
      supabase.from("commissions").select("amount").eq("rep_id", repId),
    ]);
  if (!rep) return null;

  let lastSignInAt: string | null = null;
  let createdAt: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(repId);
    lastSignInAt = data.user?.last_sign_in_at ?? null;
    createdAt = data.user?.created_at ?? null;
  } catch {
    /* service role unavailable */
  }

  const reqs = requests ?? [];
  // Each deal's current invoice-request status (so the table reflects approvals
  // / rejections, not the raw deal.status which stays "invoice_requested").
  const statusByDeal = new Map(reqs.map((r) => [r.deal_id, r.status]));
  return {
    id: rep.id,
    name: profile?.full_name || rep.display_name || "Rep",
    email: profile?.email ?? null,
    phone: rep.phone,
    commissionRate: Number(rep.commission_rate),
    active: rep.active,
    dealsCount: (deals ?? []).length,
    pendingRequests: reqs.filter((x) => x.status === "pending").length,
    approvedRequests: reqs.filter((x) => x.status === "approved" || x.status === "invoiced").length,
    salesValue: (deals ?? []).reduce((s, d) => s + Number(d.price || 0), 0),
    commissionTotal: (commissions ?? []).reduce((s, c) => s + Number(c.amount || 0), 0),
    lastSignInAt,
    createdAt,
    deals: (deals ?? []).map((d) => ({
      ...d,
      requestStatus: (statusByDeal.get(d.id) ?? "pending") as
        import("@/lib/database.types").InvoiceRequestStatus,
    })),
  };
}
