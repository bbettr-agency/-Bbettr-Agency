import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import type { Deal, InvoiceRequestStatus } from "@/lib/database.types";

/** Is a timestamp within the current calendar month? */
function isThisMonth(ts: string): boolean {
  const now = new Date();
  const d = new Date(ts);
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  );
}

/** Fetch a rep's own raw data once (RLS scopes to rep_id = auth.uid()). */
async function fetchRepData(repId: string) {
  const supabase = await createClient();
  const [{ data: deals }, { data: requests }, { data: commissions }, { data: payments }] =
    await Promise.all([
      supabase
        .from("deals")
        .select("*")
        .eq("rep_id", repId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_requests")
        .select(
          "id, deal_id, status, amount, quickbooks_invoice_number, updated_at, created_at"
        )
        .eq("rep_id", repId),
      supabase
        .from("commissions")
        .select("deal_id, amount, status, created_at")
        .eq("rep_id", repId),
      // RLS lets a rep read PayFast payments for their own requests.
      supabase
        .from("payfast_payments")
        .select("invoice_request_id, status"),
    ]);
  return {
    deals: deals ?? [],
    requests: requests ?? [],
    commissions: commissions ?? [],
    payments: payments ?? [],
  };
}

export type DealView = Deal & {
  requestStatus: InvoiceRequestStatus;
  invoiceNumber: string | null;
  /** PayFast status for international deals (null for SA / no link yet). */
  paymentStatus: string | null;
};

/** A rep's deals, each annotated with its invoice-request status + number. */
export async function getRepDealViews(repId: string): Promise<DealView[]> {
  const { deals, requests, payments } = await fetchRepData(repId);
  const byDeal = new Map(requests.map((r) => [r.deal_id, r]));
  const payByRequest = new Map(payments.map((p) => [p.invoice_request_id, p.status]));
  return deals.map((d) => {
    const req = byDeal.get(d.id);
    return {
      ...d,
      requestStatus: (req?.status ?? "pending") as InvoiceRequestStatus,
      // Only surface the number once the invoice actually exists — a number can
      // be reserved before creation succeeds.
      invoiceNumber:
        req?.status === "invoiced" ? req?.quickbooks_invoice_number ?? null : null,
      paymentStatus: req ? payByRequest.get(req.id) ?? null : null,
    };
  });
}

export interface ActivityItem {
  id: string;
  kind: "submitted" | "approved" | "rejected" | "commission";
  label: string;
  at: string;
}

export interface RepDashboard {
  totalDeals: number;
  commissionEarned: number;
  awaitingApproval: number;
  month: {
    dealsClosed: number;
    salesValue: number;
    commission: number;
    pending: number;
  };
  lifetime: {
    totalDeals: number;
    totalSalesValue: number;
    totalCommission: number;
  };
  activity: ActivityItem[];
}

/** The rep overview/dashboard — never exposes company-wide pipeline. */
export async function getRepDashboard(repId: string): Promise<RepDashboard> {
  const { deals, requests, commissions } = await fetchRepData(repId);
  const dealName = new Map(deals.map((d) => [d.id, d.business_name]));

  const commissionEarned = commissions.reduce(
    (s, c) => s + (Number(c.amount) || 0),
    0
  );
  const pending = requests.filter((r) => r.status === "pending").length;

  const monthDeals = deals.filter((d) => isThisMonth(d.created_at));
  const monthCommissions = commissions.filter((c) => isThisMonth(c.created_at));

  const activity: ActivityItem[] = [
    ...deals.map((d) => ({
      id: `d-${d.id}`,
      kind: "submitted" as const,
      label: `Deal submitted — ${d.business_name}`,
      at: d.created_at,
    })),
    ...requests
      .filter((r) => r.status === "approved" || r.status === "invoiced")
      .map((r) => ({
        id: `ra-${r.deal_id}`,
        kind: "approved" as const,
        label: `Invoice approved — ${dealName.get(r.deal_id) ?? "deal"}`,
        at: r.updated_at,
      })),
    ...requests
      .filter((r) => r.status === "rejected")
      .map((r) => ({
        id: `rr-${r.deal_id}`,
        kind: "rejected" as const,
        label: `Deal rejected — ${dealName.get(r.deal_id) ?? "deal"}`,
        at: r.updated_at,
      })),
    ...commissions.map((c, i) => ({
      id: `c-${c.deal_id}-${i}`,
      kind: "commission" as const,
      label: `Commission recorded — ${formatCurrency(Number(c.amount))}`,
      at: c.created_at,
    })),
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 8);

  return {
    totalDeals: deals.length,
    commissionEarned,
    awaitingApproval: pending,
    month: {
      dealsClosed: monthDeals.length,
      salesValue: monthDeals.reduce((s, d) => s + (Number(d.price) || 0), 0),
      commission: monthCommissions.reduce(
        (s, c) => s + (Number(c.amount) || 0),
        0
      ),
      pending,
    },
    lifetime: {
      totalDeals: deals.length,
      totalSalesValue: deals.reduce((s, d) => s + (Number(d.price) || 0), 0),
      totalCommission: commissionEarned,
    },
    activity,
  };
}

export interface EarningsMonth {
  key: string;
  label: string;
  salesValue: number;
  commission: number;
}

export interface RepEarnings {
  totalCommission: number;
  commissionThisMonth: number;
  approvedDeals: number;
  pendingCommission: number;
  months: EarningsMonth[];
}

/** Earnings breakdown for the rep's My Earnings page. */
export async function getRepEarnings(repId: string): Promise<RepEarnings> {
  const { deals, requests, commissions } = await fetchRepData(repId);
  const dealPrice = new Map(deals.map((d) => [d.id, Number(d.price) || 0]));

  const totalCommission = commissions.reduce(
    (s, c) => s + (Number(c.amount) || 0),
    0
  );
  const commissionThisMonth = commissions
    .filter((c) => isThisMonth(c.created_at))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const pendingCommission = commissions
    .filter((c) => c.status === "pending")
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const approvedDeals = requests.filter(
    (r) => r.status === "approved" || r.status === "invoiced"
  ).length;

  const monthMap = new Map<string, EarningsMonth>();
  for (const c of commissions) {
    const d = new Date(c.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry =
      monthMap.get(key) ??
      {
        key,
        label: d.toLocaleString("en-ZA", { month: "long", year: "numeric" }),
        salesValue: 0,
        commission: 0,
      };
    entry.commission += Number(c.amount) || 0;
    entry.salesValue += dealPrice.get(c.deal_id) ?? 0;
    monthMap.set(key, entry);
  }
  const months = Array.from(monthMap.values()).sort((a, b) =>
    a.key < b.key ? 1 : -1
  );

  return {
    totalCommission,
    commissionThisMonth,
    approvedDeals,
    pendingCommission,
    months,
  };
}
