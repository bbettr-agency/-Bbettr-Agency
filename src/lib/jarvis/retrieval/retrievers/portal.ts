import "server-only";

import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { RetrieverDescriptor, RetrieverContext, RetrieverInput, EvidenceFact } from "../types";
import { fact, freshest, result, timed } from "./helpers";
import { summarizeUnpaid } from "../financial";

/**
 * Jarvis Retrieval V2 — Portal operational domain retrievers (Slice 1).
 *
 * Every read runs under the caller's RLS identity (rc.supabase = createClient()).
 * NO service-role. Explicit column projections only (never select *), bounded,
 * ordered, with freshness + truncation. Free text is redacted at the provider
 * boundary by the serializer; the onboarding jsonb is additionally summarised to
 * keys + per-value secret-scanned previews (never a raw dump). Files expose
 * METADATA only — never path, bytes, or signed URLs.
 */

const POR = "portal_operational" as const;
const FINANCIAL_SUM_SAMPLE = 8;

/** Secret-scanned, clipped preview of a value for provider context. */
function scanPreview(v: unknown, max = 80): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const scanned = redactIfSecret(s);
  return scanned.length > max ? scanned.slice(0, max) + "…" : scanned;
}

const today = (rc: RetrieverContext) => rc.now().toISOString().slice(0, 10);

// ── client_identity ──────────────────────────────────────────────────────────
async function identityFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number) {
  const e = input.entity;
  const { data } = await rc.supabase
    .from("clients")
    .select("id, name, status, onboarding_type, intake_status, estimated_launch_date, website_preview_url, website_live_url, success_manager_id, updated_at")
    .eq("id", e.id)
    .maybeSingle();
  if (!data) return result("client_identity", POR, [], { returned: 0, available: 0, tookMs: rc.now().getTime() - startMs });
  let smName: string | null = null;
  if (data.success_manager_id) {
    const { data: sm } = await rc.supabase.from("team_members").select("name").eq("id", data.success_manager_id).maybeSingle();
    smName = sm?.name ?? null;
  }
  const facts: EvidenceFact[] = [
    fact("client_identity", POR, e, "Status", data.status, "clients.status", { recordRef: `clients:${data.id}` }),
    fact("client_identity", POR, e, "Onboarding type", data.onboarding_type, "clients.onboarding_type"),
    fact("client_identity", POR, e, "Intake status", data.intake_status, "clients.intake_status"),
  ];
  if (data.estimated_launch_date) facts.push(fact("client_identity", POR, e, "Estimated launch", data.estimated_launch_date, "clients.estimated_launch_date"));
  if (data.website_live_url) facts.push(fact("client_identity", POR, e, "Website (live)", data.website_live_url, "clients.website_live_url"));
  else if (data.website_preview_url) facts.push(fact("client_identity", POR, e, "Website (preview)", data.website_preview_url, "clients.website_preview_url"));
  if (smName) facts.push(fact("client_identity", POR, e, "Success manager", smName, "team_members.name"));
  return result("client_identity", POR, facts, { returned: facts.length, available: facts.length, freshestAt: data.updated_at, tookMs: rc.now().getTime() - startMs });
}
const clientIdentity: RetrieverDescriptor = {
  domain: "client_identity",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("client_identity", POR, rc.now, (s) => identityFacts(i, rc, s)),
  runDetail: (i, rc) => timed("client_identity", POR, rc.now, (s) => identityFacts(i, rc, s)),
};

// ── generic list-domain factory (count + rows) ───────────────────────────────
interface ListSpec {
  domain: RetrieverDescriptor["domain"];
  summaryK: number;
  freshnessField: string | null;
  /** Build facts from rows (used for both summary top-K and detail). */
  toFacts: (rows: Record<string, unknown>[], input: RetrieverInput) => EvidenceFact[];
  /** Optional extra summary rollup fact(s) from (rows, count). */
  rollup?: (rows: Record<string, unknown>[], count: number, input: RetrieverInput) => EvidenceFact[];
}

// ── client_services ──────────────────────────────────────────────────────────
const clientServices: RetrieverDescriptor = listDomain(
  {
    domain: "client_services",
    summaryK: 8,
    freshnessField: null,
    toFacts: (rows, i) =>
      rows.map((r) =>
        fact("client_services", POR, i.entity, String(r.service), { onboarding: r.onboarding_status, operational: r.operational_status ?? null }, "client_services")
      ),
  },
  async (rc, id, k) =>
    rc.supabase.from("client_services").select("service, onboarding_status, operational_status", { count: "exact" }).eq("client_id", id).order("service", { ascending: true }).limit(k)
);

// ── project_stages ───────────────────────────────────────────────────────────
const projectStages: RetrieverDescriptor = listDomain(
  {
    domain: "project_stages",
    summaryK: 12,
    freshnessField: null,
    toFacts: (rows, i) => rows.map((r, idx) => fact("project_stages", POR, i.entity, `Stage ${r.position ?? idx}: ${scanPreview(r.name, 60)}`, r.status, "project_stages")),
    rollup: (rows, count, i) => {
      const current = rows.find((r) => String(r.status) !== "completed" && String(r.status) !== "done");
      return [fact("project_stages", POR, i.entity, "Current stage", current ? scanPreview(current.name, 60) : "none active", "project_stages", {}), fact("project_stages", POR, i.entity, "Total stages", count, "project_stages")];
    },
  },
  async (rc, id, k) => rc.supabase.from("project_stages").select("name, status, position", { count: "exact" }).eq("client_id", id).order("position", { ascending: true }).limit(k)
);

// ── updates ──────────────────────────────────────────────────────────────────
const updates: RetrieverDescriptor = listDomain(
  {
    domain: "updates",
    summaryK: 5,
    freshnessField: "published_at",
    toFacts: (rows, i) => rows.map((r) => fact("updates", POR, i.entity, scanPreview(r.title, 80), r.published_at, "updates", { occurredAt: r.published_at as string })),
  },
  async (rc, id, k) => rc.supabase.from("updates").select("title, published_at, author_name", { count: "exact" }).eq("client_id", id).order("published_at", { ascending: false }).limit(k)
);

// ── reports ──────────────────────────────────────────────────────────────────
const reports: RetrieverDescriptor = listDomain(
  {
    domain: "reports",
    summaryK: 3,
    freshnessField: "reporting_month",
    toFacts: (rows, i) =>
      rows.map((r) =>
        fact("reports", POR, i.entity, `Report ${r.reporting_month}`, { ad_spend: r.ad_spend, leads: r.leads_generated, cost_per_lead: r.cost_per_lead, conversion_rate: r.conversion_rate, summary: r.summary ? scanPreview(r.summary, 160) : null }, "reports", { occurredAt: r.reporting_month as string })
      ),
  },
  async (rc, id, k) => rc.supabase.from("reports").select("reporting_month, summary, ad_spend, leads_generated, cost_per_lead, conversion_rate", { count: "exact" }).eq("client_id", id).order("reporting_month", { ascending: false }).limit(k)
);

// ── contracts ────────────────────────────────────────────────────────────────
const contracts: RetrieverDescriptor = listDomain(
  {
    domain: "contracts",
    summaryK: 5,
    freshnessField: "signed_at",
    toFacts: (rows, i) => rows.map((r) => fact("contracts", POR, i.entity, scanPreview(r.title, 60), { status: r.status, sent_at: r.sent_at, signed_at: r.signed_at }, "contracts", { occurredAt: (r.signed_at ?? r.sent_at) as string })),
  },
  async (rc, id, k) => rc.supabase.from("contracts").select("title, status, sent_at, signed_at", { count: "exact" }).eq("client_id", id).order("sent_at", { ascending: false }).limit(k)
);

// ── payments ─────────────────────────────────────────────────────────────────
const payments: RetrieverDescriptor = listDomain(
  {
    domain: "payments",
    summaryK: 6,
    freshnessField: "received_at",
    toFacts: (rows, i) => rows.map((r) => fact("payments", POR, i.entity, `Payment ${r.received_at}`, { amount: r.amount, method: r.method, reference: r.reference ? scanPreview(r.reference, 40) : null }, "client_payments", { occurredAt: r.received_at as string })),
  },
  async (rc, id, k) => rc.supabase.from("client_payments").select("amount, method, reference, received_at", { count: "exact" }).eq("client_id", id).order("received_at", { ascending: false }).limit(k)
);

// ── retainers ────────────────────────────────────────────────────────────────
const retainers: RetrieverDescriptor = listDomain(
  {
    domain: "retainers",
    summaryK: 5,
    freshnessField: "started_at",
    toFacts: (rows, i) => rows.map((r) => fact("retainers", POR, i.entity, scanPreview(r.name, 60), { amount: r.amount, cadence: r.cadence, active: r.active }, "client_retainers", { occurredAt: r.started_at as string })),
  },
  async (rc, id, k) => rc.supabase.from("client_retainers").select("name, amount, cadence, active, started_at", { count: "exact" }).eq("client_id", id).order("started_at", { ascending: false }).limit(k)
);

// ── activity ─────────────────────────────────────────────────────────────────
const activity: RetrieverDescriptor = listDomain(
  {
    domain: "activity",
    summaryK: 8,
    freshnessField: "occurred_at",
    toFacts: (rows, i) => rows.map((r) => fact("activity", POR, i.entity, scanPreview(r.title, 70), { type: r.type, visibility: r.visibility }, "activity_events", { occurredAt: r.occurred_at as string })),
  },
  async (rc, id, k) => rc.supabase.from("activity_events").select("type, title, visibility, occurred_at", { count: "exact" }).eq("client_id", id).order("occurred_at", { ascending: false }).limit(k)
);

// ── weekly_updates ───────────────────────────────────────────────────────────
const weeklyUpdates: RetrieverDescriptor = listDomain(
  {
    domain: "weekly_updates",
    summaryK: 4,
    freshnessField: "update_date",
    toFacts: (rows, i) => rows.map((r) => fact("weekly_updates", POR, i.entity, `Weekly ${r.update_date}`, scanPreview(r.summary, 160), "weekly_updates", { occurredAt: r.update_date as string })),
  },
  async (rc, id, k) => rc.supabase.from("weekly_updates").select("summary, update_date, author_user_id", { count: "exact" }).eq("client_id", id).order("update_date", { ascending: false }).limit(k)
);

// ── deals ────────────────────────────────────────────────────────────────────
const deals: RetrieverDescriptor = listDomain(
  {
    domain: "deals",
    summaryK: 3,
    freshnessField: null,
    toFacts: (rows, i) => rows.map((r) => fact("deals", POR, i.entity, scanPreview(r.business_name, 60), { status: r.status, package: r.package, price: r.price, currency: r.currency, retainer: r.has_monthly_retainer ? r.monthly_retainer_amount : null }, "deals")),
  },
  async (rc, id, k) => rc.supabase.from("deals").select("business_name, package, price, currency, status, has_monthly_retainer, monthly_retainer_amount", { count: "exact" }).eq("client_id", id).order("created_at", { ascending: false }).limit(k)
);

// ── files (METADATA ONLY) ────────────────────────────────────────────────────
const files: RetrieverDescriptor = listDomain(
  {
    domain: "files",
    summaryK: 10,
    freshnessField: "created_at",
    toFacts: (rows, i) => rows.map((r) => fact("files", POR, i.entity, scanPreview(r.name, 70), { category: r.asset_category, mime: r.mime_type, bytes: r.size_bytes, client_visible: r.client_visible }, "files", { occurredAt: r.created_at as string })),
    rollup: (rows, count, i) => [fact("files", POR, i.entity, "Total files", count, "files")],
  },
  // NOTE: no `path`, no signed URL — metadata only.
  async (rc, id, k) => rc.supabase.from("files").select("name, asset_category, mime_type, size_bytes, client_visible, created_at", { count: "exact" }).eq("client_id", id).order("created_at", { ascending: false }).limit(k)
);

// ── tasks (open + overdue) ───────────────────────────────────────────────────
async function tasksFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number, limit: number) {
  const e = input.entity;
  const { data, count } = await rc.supabase
    .from("tasks")
    .select("title, status, priority, due_date, scheduled_date", { count: "exact" })
    .eq("client_id", e.id)
    .not("status", "in", "(completed,archived)")
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);
  const rows = data ?? [];
  const { count: overdue } = await rc.supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("client_id", e.id)
    .not("status", "in", "(completed,archived)")
    .is("deleted_at", null)
    .lt("due_date", today(rc));
  const facts: EvidenceFact[] = [
    fact("tasks", POR, e, "Open tasks", count ?? rows.length, "tasks"),
    fact("tasks", POR, e, "Overdue tasks", overdue ?? 0, "tasks"),
    ...rows.map((r) => fact("tasks", POR, e, scanPreview(r.title, 70), { status: r.status, priority: r.priority, due_date: r.due_date }, "tasks", { occurredAt: r.due_date as string })),
  ];
  return result("tasks", POR, facts, { returned: rows.length, available: count ?? rows.length, tookMs: rc.now().getTime() - startMs });
}
const tasks: RetrieverDescriptor = {
  domain: "tasks",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("tasks", POR, rc.now, (s) => tasksFacts(i, rc, s, 3)),
  runDetail: (i, rc) => timed("tasks", POR, rc.now, (s) => tasksFacts(i, rc, s, i.detailLimit ?? 10)),
};

// ── invoices (financial, bounded lower-bound aggregate) ──────────────────────
async function invoicesFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number, detail: boolean, limit: number) {
  const e = input.entity;
  const { data: unpaidRows, count: unpaidCount } = await rc.supabase
    .from("client_invoices")
    .select("amount, currency", { count: "exact" })
    .eq("client_id", e.id)
    .eq("status", "sent")
    .limit(FINANCIAL_SUM_SAMPLE);
  const summary = summarizeUnpaid((unpaidRows ?? []).map((r) => ({ amount: Number(r.amount), currency: String(r.currency) })), unpaidCount ?? (unpaidRows?.length ?? 0));
  const facts: EvidenceFact[] = [fact("invoices", POR, e, "Outstanding (unpaid) invoices", summary, "client_invoices")];
  let available = unpaidCount ?? 0;
  if (detail) {
    const { data, count } = await rc.supabase
      .from("client_invoices")
      .select("invoice_number, title, amount, currency, kind, status, issued_at, due_at, paid_at", { count: "exact" })
      .eq("client_id", e.id)
      .order("issued_at", { ascending: false })
      .limit(limit);
    const rows = data ?? [];
    available = count ?? rows.length;
    for (const r of rows) facts.push(fact("invoices", POR, e, `Invoice ${r.invoice_number}`, { title: scanPreview(r.title, 50), amount: r.amount, currency: r.currency, status: r.status, issued_at: r.issued_at, due_at: r.due_at, paid_at: r.paid_at }, "client_invoices", { occurredAt: r.issued_at as string }));
    return result("invoices", POR, facts, { returned: rows.length, available, tookMs: rc.now().getTime() - startMs });
  }
  return result("invoices", POR, facts, { returned: facts.length, available: facts.length, tookMs: rc.now().getTime() - startMs });
}
const invoices: RetrieverDescriptor = {
  domain: "invoices",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("invoices", POR, rc.now, (s) => invoicesFacts(i, rc, s, false, 0)),
  runDetail: (i, rc) => timed("invoices", POR, rc.now, (s) => invoicesFacts(i, rc, s, true, i.detailLimit ?? 8)),
};

// ── onboarding (jsonb summarised, values secret-scanned) ─────────────────────
async function onboardingFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number, detail: boolean, limit: number) {
  const e = input.entity;
  const { data, count } = await rc.supabase
    .from("onboarding_submissions")
    .select("service, status, submitted_at, data", { count: "exact" })
    .eq("client_id", e.id)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  const facts: EvidenceFact[] = rows.map((r) => {
    const base: Record<string, unknown> = { status: r.status, submitted_at: r.submitted_at };
    if (detail && r.data && typeof r.data === "object") {
      const obj = r.data as Record<string, unknown>;
      const preview: Record<string, string> = {};
      let n = 0;
      for (const k of Object.keys(obj)) {
        if (n >= 12) break;
        preview[k] = scanPreview(obj[k], 40); // per-value secret scan; NEVER a raw dump
        n++;
      }
      base.fields = preview;
    }
    return fact("onboarding", POR, e, `Onboarding: ${r.service}`, base, "onboarding_submissions", { occurredAt: r.submitted_at as string });
  });
  return result("onboarding", POR, facts, { returned: rows.length, available: count ?? rows.length, freshestAt: freshest(rows.map((r) => r.submitted_at as string)), tookMs: rc.now().getTime() - startMs });
}
const onboarding: RetrieverDescriptor = {
  domain: "onboarding",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("onboarding", POR, rc.now, (s) => onboardingFacts(i, rc, s, false, 8)),
  runDetail: (i, rc) => timed("onboarding", POR, rc.now, (s) => onboardingFacts(i, rc, s, true, i.detailLimit ?? 8)),
};

// ── on-demand: billing_details (PII) ─────────────────────────────────────────
async function billingFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number) {
  const e = input.entity;
  const { data } = await rc.supabase
    .from("client_billing_details")
    .select("invoice_name, vat_number, billing_email, billing_address, po_reference")
    .eq("client_id", e.id)
    .maybeSingle();
  if (!data) return result("billing_details", POR, [], { returned: 0, available: 0, tookMs: rc.now().getTime() - startMs });
  const facts = [
    fact("billing_details", POR, e, "Billing", { invoice_name: scanPreview(data.invoice_name, 60), vat_number: scanPreview(data.vat_number, 40), billing_email: scanPreview(data.billing_email, 60), billing_address: scanPreview(data.billing_address, 120), po_reference: scanPreview(data.po_reference, 40) }, "client_billing_details"),
  ];
  return result("billing_details", POR, facts, { returned: facts.length, available: facts.length, tookMs: rc.now().getTime() - startMs });
}
const billingDetails: RetrieverDescriptor = {
  domain: "billing_details",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("billing_details", POR, rc.now, (s) => billingFacts(i, rc, s)),
  runDetail: (i, rc) => timed("billing_details", POR, rc.now, (s) => billingFacts(i, rc, s)),
};

// ── on-demand: update_questions ──────────────────────────────────────────────
const updateQuestions: RetrieverDescriptor = listDomain(
  {
    domain: "update_questions",
    summaryK: 5,
    freshnessField: "created_at",
    toFacts: (rows, i) => rows.map((r) => fact("update_questions", POR, i.entity, `${r.channel} (${r.status})`, scanPreview(r.message, 120), "update_questions", { occurredAt: r.created_at as string })),
  },
  async (rc, id, k) => rc.supabase.from("update_questions").select("channel, message, status, created_at", { count: "exact" }).eq("client_id", id).order("created_at", { ascending: false }).limit(k)
);

// ── on-demand: people (contact PII + success manager) ────────────────────────
async function peopleFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number) {
  const e = input.entity;
  const { data } = await rc.supabase.from("clients").select("contact_name, contact_email, contact_phone, success_manager_id").eq("id", e.id).maybeSingle();
  if (!data) return result("people", POR, [], { returned: 0, available: 0, tookMs: rc.now().getTime() - startMs });
  const facts: EvidenceFact[] = [
    fact("people", POR, e, "Client contact", { name: scanPreview(data.contact_name, 60), email: scanPreview(data.contact_email, 60), phone: scanPreview(data.contact_phone, 40) }, "clients"),
  ];
  if (data.success_manager_id) {
    const { data: sm } = await rc.supabase.from("team_members").select("name, email").eq("id", data.success_manager_id).maybeSingle();
    if (sm) facts.push(fact("people", POR, e, "Success manager", { name: sm.name, email: scanPreview(sm.email, 60) }, "team_members"));
  }
  return result("people", POR, facts, { returned: facts.length, available: facts.length, tookMs: rc.now().getTime() - startMs });
}
const people: RetrieverDescriptor = {
  domain: "people",
  authority: POR,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("people", POR, rc.now, (s) => peopleFacts(i, rc, s)),
  runDetail: (i, rc) => timed("people", POR, rc.now, (s) => peopleFacts(i, rc, s)),
};

// ── factory implementation ───────────────────────────────────────────────────
type QueryFn = (
  rc: RetrieverContext,
  clientId: string,
  limit: number
) => Promise<{ data: Record<string, unknown>[] | null; count: number | null }>;

function listDomain(spec: ListSpec, query: QueryFn): RetrieverDescriptor {
  async function run(input: RetrieverInput, rc: RetrieverContext, startMs: number, limit: number, withRollup: boolean) {
    const { data, count } = await query(rc, input.entity.id, limit);
    const rows = data ?? [];
    const facts: EvidenceFact[] = [];
    if (withRollup && spec.rollup) facts.push(...spec.rollup(rows, count ?? rows.length, input));
    facts.push(...spec.toFacts(rows, input));
    const freshestAt = spec.freshnessField ? freshest(rows.map((r) => r[spec.freshnessField!] as string)) : null;
    return result(spec.domain, POR, facts, { returned: rows.length, available: count ?? rows.length, freshestAt, tookMs: rc.now().getTime() - startMs });
  }
  return {
    domain: spec.domain,
    authority: POR,
    authorization: "rls_principal",
    runSummary: (i, rc) => timed(spec.domain, POR, rc.now, (s) => run(i, rc, s, spec.summaryK, true)),
    runDetail: (i, rc) => timed(spec.domain, POR, rc.now, (s) => run(i, rc, s, i.detailLimit ?? spec.summaryK, false)),
  };
}

export const PORTAL_RETRIEVERS: RetrieverDescriptor[] = [
  clientIdentity,
  clientServices,
  projectStages,
  onboarding,
  updates,
  tasks,
  reports,
  contracts,
  invoices,
  payments,
  retainers,
  activity,
  weeklyUpdates,
  deals,
  files,
  billingDetails,
  updateQuestions,
  people,
];
