import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Client,
  ClientService,
  ProjectStage,
  DealStatus,
  ClientInvoice,
  ClientPayment,
  ClientRetainer,
  InvoiceStatus,
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

/**
 * Activity timeline for a client (incl. internal events). Admin view.
 *
 * With `limit` it fetches only the most recent N (the fast Work-page default,
 * Slice 2B); without it, the FULL history — used by loadClientActivityAction
 * when an admin explicitly opens "View full history". No event is filtered out;
 * ordering is always newest-first.
 */
export async function getClientActivity(clientId: string, limit?: number) {
  const supabase = await createClient();
  let query = supabase
    .from("activity_events")
    .select("id, type, title, description, visibility, occurred_at, source")
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: false });
  if (limit !== undefined) query = query.limit(limit);
  const { data } = await query;
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

// ── Deal ↔ Client linkage (Phase D2) ───────────────────────────────────────

export interface DealLink {
  deal: {
    id: string;
    business_name: string;
    package: string | null;
    price: number | null;
    status: DealStatus;
  };
  /** Latest invoice_request status for the deal, or null if none raised. */
  invoiceStatus: string | null;
  /** PayFast payment status (international only), or null. */
  paymentStatus: string | null;
}

/** The deal linked to a client (one per client), with invoice + payment status. */
export async function getClientDealLink(
  clientId: string
): Promise<DealLink | null> {
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, business_name, package, price, status")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!deal) return null;

  const { data: req } = await supabase
    .from("invoice_requests")
    .select("id, status")
    .eq("deal_id", deal.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let paymentStatus: string | null = null;
  if (req) {
    const { data: pay } = await supabase
      .from("payfast_payments")
      .select("status")
      .eq("invoice_request_id", req.id)
      .maybeSingle();
    paymentStatus = pay?.status ?? null;
  }

  return {
    deal: {
      id: deal.id,
      business_name: deal.business_name,
      package: deal.package,
      price: deal.price,
      status: deal.status,
    },
    invoiceStatus: req?.status ?? null,
    paymentStatus,
  };
}

export interface LinkableDeal {
  id: string;
  business_name: string;
  package: string | null;
  price: number | null;
  repName: string | null;
}

/** Unlinked deals (client_id IS NULL) the admin can attach to a client. */
export async function getLinkableDeals(): Promise<LinkableDeal[]> {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, business_name, package, price, rep_id")
    .is("client_id", null)
    .order("created_at", { ascending: false });
  const list = deals ?? [];
  if (list.length === 0) return [];

  const repIds = [...new Set(list.map((d) => d.rep_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", repIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return list.map((d) => ({
    id: d.id,
    business_name: d.business_name,
    package: d.package,
    price: d.price,
    repName: nameById.get(d.rep_id) ?? null,
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

// ── Client Billing (Phase E1) ───────────────────────────────────────────────

/** An invoice plus derived payment state (overdue is computed, never stored). */
export interface BillingInvoice extends ClientInvoice {
  amountPaid: number;
  balance: number;
  derivedStatus: InvoiceStatus | "overdue";
  /** Linked invoice PDF (Files & Assets), for admin download (if any). */
  pdf: { name: string; path: string } | null;
}

export interface BillingPayment extends ClientPayment {
  invoiceNumber: string | null;
  /** Currency of the linked invoice (payments store no currency of their own). */
  invoiceCurrency: string | null;
}

export type BillingRetainer = ClientRetainer;

export interface ClientBilling {
  invoices: BillingInvoice[];
  payments: BillingPayment[];
  retainers: BillingRetainer[];
  kpis: {
    /**
     * Money totals are kept PER CURRENCY (e.g. { ZAR: 12000, USD: 500 }) —
     * ZAR and USD amounts are never summed into one misleading number.
     */
    outstandingByCurrency: Record<string, number>;
    paidByCurrency: Record<string, number>;
    overdueCount: number;
    activeRetainers: number;
  };
}

/**
 * Full billing picture for one client: invoices (with derived paid/overdue
 * state), payment history, retainers, and the dashboard KPIs. Admin-only.
 *
 * "Overdue" is derived here (status='sent' AND past due) so no scheduled job is
 * needed. "Paid lifetime" is the sum of recorded payments (money actually
 * received), independent of invoice status.
 */
export async function getClientBilling(clientId: string): Promise<ClientBilling> {
  const supabase = await createClient();

  const [{ data: invoiceRows }, { data: paymentRows }, { data: retainerRows }] =
    await Promise.all([
      supabase
        .from("client_invoices")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_payments")
        .select("*")
        .eq("client_id", clientId)
        .order("received_at", { ascending: false }),
      supabase
        .from("client_retainers")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
    ]);

  const invoiceList = invoiceRows ?? [];
  const paymentList = paymentRows ?? [];
  const retainerList = retainerRows ?? [];
  const now = Date.now();

  // Resolve linked invoice PDFs (Files & Assets) for admin download.
  const invoiceFileIds = invoiceList
    .map((i) => i.file_id)
    .filter((id): id is string => Boolean(id));
  const invoiceFileMap = new Map<string, { name: string; path: string }>();
  if (invoiceFileIds.length > 0) {
    const { data: invoiceFiles } = await supabase
      .from("files")
      .select("id, name, path")
      .in("id", invoiceFileIds);
    for (const f of invoiceFiles ?? [])
      invoiceFileMap.set(f.id, { name: f.name, path: f.path });
  }

  // Sum payments per invoice for balance + paid detection.
  const paidByInvoice = new Map<string, number>();
  for (const p of paymentList) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(
      p.invoice_id,
      (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount)
    );
  }

  const invoices: BillingInvoice[] = invoiceList.map((inv) => {
    const amountPaid = paidByInvoice.get(inv.id) ?? 0;
    const balance = Number(inv.amount) - amountPaid;
    const isOverdue =
      inv.status === "sent" && inv.due_at != null && new Date(inv.due_at).getTime() < now;
    return {
      ...inv,
      amountPaid,
      balance,
      derivedStatus: isOverdue ? "overdue" : inv.status,
      pdf: inv.file_id ? invoiceFileMap.get(inv.file_id) ?? null : null,
    };
  });

  const numberById = new Map(invoiceList.map((i) => [i.id, i.invoice_number]));
  const currencyById = new Map(invoiceList.map((i) => [i.id, i.currency]));
  const payments: BillingPayment[] = paymentList.map((p) => ({
    ...p,
    invoiceNumber: p.invoice_id ? numberById.get(p.invoice_id) ?? null : null,
    invoiceCurrency: p.invoice_id ? currencyById.get(p.invoice_id) ?? null : null,
  }));

  // Money KPIs are grouped per currency — never a mixed ZAR+USD sum. Payments
  // inherit their linked invoice's currency; unlinked payments default to ZAR
  // (the historic behaviour — payments store no currency of their own).
  const addTo = (acc: Record<string, number>, currency: string, amount: number) => {
    acc[currency] = (acc[currency] ?? 0) + amount;
  };
  const outstandingByCurrency: Record<string, number> = {};
  for (const i of invoices) {
    if (i.status === "sent") addTo(outstandingByCurrency, i.currency, i.balance);
  }
  const paidByCurrency: Record<string, number> = {};
  for (const p of payments) {
    addTo(paidByCurrency, p.invoiceCurrency ?? "ZAR", Number(p.amount));
  }

  const overdueCount = invoices.filter((i) => i.derivedStatus === "overdue").length;
  const activeRetainers = retainerList.filter((r) => r.active).length;

  return {
    invoices,
    payments,
    retainers: retainerList,
    kpis: { outstandingByCurrency, paidByCurrency, overdueCount, activeRetainers },
  };
}

/** A client's ❓ follow-up request, with the related update's title resolved. */
export interface UpdateQuestionView {
  id: string;
  update_id: string;
  updateTitle: string | null;
  channel: "callback" | "email";
  message: string | null;
  status: "open" | "resolved";
  created_at: string;
}

/**
 * All ❓ follow-up requests a client has raised on their updates, newest first,
 * with the related update title resolved for display. Admin-only.
 */
export async function getClientUpdateQuestions(
  clientId: string
): Promise<UpdateQuestionView[]> {
  const supabase = await createClient();
  const { data: questions } = await supabase
    .from("update_questions")
    .select("id, update_id, channel, message, status, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (!questions || questions.length === 0) return [];

  const updateIds = [...new Set(questions.map((q) => q.update_id))];
  const titleById = new Map<string, string>();
  const { data: updates } = await supabase
    .from("updates")
    .select("id, title")
    .in("id", updateIds);
  for (const u of updates ?? []) titleById.set(u.id, u.title);

  return questions.map((q) => ({
    id: q.id,
    update_id: q.update_id,
    updateTitle: titleById.get(q.update_id) ?? null,
    channel: q.channel,
    message: q.message,
    status: q.status,
    created_at: q.created_at,
  }));
}
