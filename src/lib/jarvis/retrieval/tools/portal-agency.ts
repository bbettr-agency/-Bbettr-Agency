import "server-only";

import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { RetrieverContext } from "../types";
import type { ReadToolDescriptor, ReadToolResult } from "./types";

/**
 * Jarvis Milestone A — AGENCY-WIDE Portal read tools (NEW surface).
 *
 * `portal_list_clients` and `portal_aggregate` give the agent a bounded, deterministic
 * cross-client view so it can answer "what needs my attention / across the agency"
 * WITHOUT hard-coded intents. All reads run under the caller's RLS identity via
 * rc.supabase (never service-role); counts are computed with { count: "exact" } or in
 * application code — the model never performs operational/financial arithmetic.
 *
 * Signal semantics are VERIFIED against the schema (no invented filters):
 *   • client_status: lead|onboarding|in_progress|active|paused|completed
 *   • onboarding_status (submissions): not_started|in_progress|submitted|approved
 *       → "incomplete onboarding" = a submission whose status ∉ {submitted, approved}
 *   • unpaid invoice = client_invoices.status = 'sent' (same rule as the Slice-1 retriever)
 *   • overdue task = open task (status ∉ completed/archived, not deleted) with due_date < today
 *   • stage waiting = stage_status ∈ {pending, in_progress}
 */

const CLIENT_SCAN_CAP = 500; // hard scan ceiling (prod has ~13 clients)
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const SIGNAL_ROW_CAP = 5000; // per signal-table scan ceiling

const OPEN_TASK_EXCLUDED = "(completed,archived)";

function ymd(rc: RetrieverContext): string {
  return rc.now().toISOString().slice(0, 10);
}

interface ClientRow {
  id: string;
  name: string;
  status: string;
}

async function loadClients(rc: RetrieverContext): Promise<{ rows: ClientRow[]; total: number }> {
  const { data, count } = await rc.supabase
    .from("clients")
    .select("id, name, status", { count: "exact" })
    .order("name", { ascending: true })
    .limit(CLIENT_SCAN_CAP);
  const rows = (data ?? []).map((r) => ({ id: r.id as string, name: ((r.name as string | null) ?? "").trim(), status: String(r.status) }));
  return { rows, total: count ?? rows.length };
}

/** Set of client_ids that currently have ≥1 OPEN task (optionally only OVERDUE). */
async function clientsWithTasks(rc: RetrieverContext, overdueOnly: boolean): Promise<Set<string>> {
  let q = rc.supabase
    .from("tasks")
    .select("client_id, due_date")
    .not("status", "in", OPEN_TASK_EXCLUDED)
    .is("deleted_at", null)
    .not("client_id", "is", null)
    .limit(SIGNAL_ROW_CAP);
  if (overdueOnly) q = q.lt("due_date", ymd(rc));
  const { data } = await q;
  const set = new Set<string>();
  for (const r of data ?? []) if (r.client_id) set.add(r.client_id as string);
  return set;
}

/** Set of client_ids with ≥1 onboarding submission not yet submitted/approved. */
async function clientsIncompleteOnboarding(rc: RetrieverContext): Promise<Set<string>> {
  const { data } = await rc.supabase
    .from("onboarding_submissions")
    .select("client_id, status")
    .not("status", "in", "(submitted,approved)")
    .limit(SIGNAL_ROW_CAP);
  const set = new Set<string>();
  for (const r of data ?? []) if (r.client_id) set.add(r.client_id as string);
  return set;
}

/** Set of client_ids with ≥1 unpaid (sent) invoice. */
async function clientsWithUnpaidInvoices(rc: RetrieverContext): Promise<Set<string>> {
  const { data } = await rc.supabase.from("client_invoices").select("client_id").eq("status", "sent").limit(SIGNAL_ROW_CAP);
  const set = new Set<string>();
  for (const r of data ?? []) if (r.client_id) set.add(r.client_id as string);
  return set;
}

/** Map client_id → most recent update published_at (ISO), for staleness. */
async function latestUpdateByClient(rc: RetrieverContext): Promise<Map<string, string>> {
  const { data } = await rc.supabase
    .from("updates")
    .select("client_id, published_at")
    .order("published_at", { ascending: false })
    .limit(SIGNAL_ROW_CAP);
  const m = new Map<string, string>();
  for (const r of data ?? []) {
    const cid = r.client_id as string | null;
    const at = r.published_at as string | null;
    if (cid && at && !m.has(cid)) m.set(cid, at); // first seen = most recent (desc order)
  }
  return m;
}

/** Set of client_ids that have a given service configured. */
type ServiceType = "website" | "google_ads" | "meta_ads" | "seo";
async function clientsWithService(rc: RetrieverContext, service: ServiceType): Promise<Set<string>> {
  const { data } = await rc.supabase.from("client_services").select("client_id").eq("service", service).limit(SIGNAL_ROW_CAP);
  const set = new Set<string>();
  for (const r of data ?? []) if (r.client_id) set.add(r.client_id as string);
  return set;
}

// ── portal_list_clients ──────────────────────────────────────────────────────
interface ListClientsArgs {
  status?: string;
  service?: string;
  has_open_tasks?: boolean;
  has_overdue_tasks?: boolean;
  incomplete_onboarding?: boolean;
  stale_updates_days?: number;
  has_unpaid_invoices?: boolean;
  limit?: number;
}

const CLIENT_STATUSES = ["lead", "onboarding", "in_progress", "active", "paused", "completed"];
const SERVICE_TYPES = ["website", "google_ads", "meta_ads", "seo"];

export const listClientsTool: ReadToolDescriptor<ListClientsArgs> = {
  name: "portal_list_clients",
  scope: "agency",
  requiredGrant: "portal.read",
  description:
    "List authorised Portal clients with optional deterministic filters (status, service, has_open_tasks, has_overdue_tasks, incomplete_onboarding, stale_updates_days, has_unpaid_invoices). Returns the authoritative total, the shown count, and whether the list is truncated. Use this to find which clients match operational signals; use portal_get_client_overview for depth on one client.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: CLIENT_STATUSES, description: "Filter by client lifecycle status." },
      service: { type: "string", enum: SERVICE_TYPES, description: "Only clients with this service configured." },
      has_open_tasks: { type: "boolean" },
      has_overdue_tasks: { type: "boolean" },
      incomplete_onboarding: { type: "boolean", description: "Clients with an onboarding submission not yet submitted/approved." },
      stale_updates_days: { type: "integer", minimum: 1, maximum: 365, description: "Clients whose most recent client update is older than N days (or who have none)." },
      has_unpaid_invoices: { type: "boolean", description: "Clients with at least one unpaid (sent) invoice." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
    },
  },
  parse(raw) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: "args must be an object" };
    const o = raw as Record<string, unknown>;
    const args: ListClientsArgs = {};
    if (o.status !== undefined) {
      if (typeof o.status !== "string" || !CLIENT_STATUSES.includes(o.status)) return { ok: false, reason: "invalid status" };
      args.status = o.status;
    }
    if (o.service !== undefined) {
      if (typeof o.service !== "string" || !SERVICE_TYPES.includes(o.service)) return { ok: false, reason: "invalid service" };
      args.service = o.service;
    }
    for (const k of ["has_open_tasks", "has_overdue_tasks", "incomplete_onboarding", "has_unpaid_invoices"] as const) {
      if (o[k] !== undefined) {
        if (typeof o[k] !== "boolean") return { ok: false, reason: `${k} must be boolean` };
        args[k] = o[k] as boolean;
      }
    }
    if (o.stale_updates_days !== undefined) {
      const n = o.stale_updates_days;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 365) return { ok: false, reason: "invalid stale_updates_days" };
      args.stale_updates_days = Math.floor(n);
    }
    if (o.limit !== undefined) {
      const n = o.limit;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > MAX_LIST_LIMIT) return { ok: false, reason: "invalid limit" };
      args.limit = Math.floor(n);
    }
    return { ok: true, args };
  },
  async run(args, rc): Promise<ReadToolResult> {
    const { rows, total } = await loadClients(rc);
    const domains = ["clients"];
    let filtered = rows;
    if (args.status) filtered = filtered.filter((c) => c.status === args.status);

    if (args.service) {
      const set = await clientsWithService(rc, args.service as ServiceType);
      domains.push("client_services");
      filtered = filtered.filter((c) => set.has(c.id));
    }
    if (args.has_open_tasks || args.has_overdue_tasks) {
      const set = await clientsWithTasks(rc, !!args.has_overdue_tasks && !args.has_open_tasks);
      domains.push("tasks");
      // If both requested, overdue implies open; compute the stricter requested one.
      const overdueSet = args.has_overdue_tasks ? await clientsWithTasks(rc, true) : null;
      filtered = filtered.filter((c) => (args.has_open_tasks ? set.has(c.id) : true) && (overdueSet ? overdueSet.has(c.id) : true));
    }
    if (args.incomplete_onboarding) {
      const set = await clientsIncompleteOnboarding(rc);
      domains.push("onboarding");
      filtered = filtered.filter((c) => set.has(c.id));
    }
    if (args.has_unpaid_invoices) {
      const set = await clientsWithUnpaidInvoices(rc);
      domains.push("invoices");
      filtered = filtered.filter((c) => set.has(c.id));
    }
    if (args.stale_updates_days) {
      const latest = await latestUpdateByClient(rc);
      domains.push("updates");
      const cutoff = rc.now().getTime() - args.stale_updates_days * 86_400_000;
      filtered = filtered.filter((c) => {
        const at = latest.get(c.id);
        return !at || new Date(at).getTime() < cutoff;
      });
    }

    const matchTotal = filtered.length;
    const limit = args.limit ?? DEFAULT_LIST_LIMIT;
    const shown = filtered.slice(0, limit);
    const truncated = filtered.length > shown.length;

    const lines: string[] = [];
    lines.push(`clients matching filter: ${matchTotal} (of ${total} total authorised clients)`);
    for (const c of shown) lines.push(`- ${redactIfSecret(c.name)} [status: ${c.status}; id: ${c.id}]`);
    if (truncated) lines.push(`- (showing ${shown.length} of ${matchTotal}; narrow the filter to see more)`);
    return { content: lines.join("\n"), total: matchTotal, shown: shown.length, truncated, domains };
  },
};

// ── portal_aggregate ─────────────────────────────────────────────────────────
type Metric =
  | "clients_by_status"
  | "open_tasks"
  | "overdue_tasks"
  | "tasks_due_today"
  | "incomplete_onboarding"
  | "unpaid_invoices"
  | "stage_distribution"
  | "stale_clients";

const METRICS: Metric[] = [
  "clients_by_status",
  "open_tasks",
  "overdue_tasks",
  "tasks_due_today",
  "incomplete_onboarding",
  "unpaid_invoices",
  "stage_distribution",
  "stale_clients",
];

interface AggregateArgs {
  metric: Metric;
  stale_days?: number;
}

export const aggregateTool: ReadToolDescriptor<AggregateArgs> = {
  name: "portal_aggregate",
  scope: "agency",
  requiredGrant: "portal.read",
  description:
    "Deterministically compute one agency-wide fact in application/database code (never ask the model to do the arithmetic). Supported metrics: clients_by_status, open_tasks, overdue_tasks, tasks_due_today, incomplete_onboarding, unpaid_invoices (reported PER CURRENCY, never combined), stage_distribution, stale_clients (needs stale_days).",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["metric"],
    properties: {
      metric: { type: "string", enum: METRICS },
      stale_days: { type: "integer", minimum: 1, maximum: 365, description: "Required for stale_clients." },
    },
  },
  parse(raw) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: "args must be an object" };
    const o = raw as Record<string, unknown>;
    if (typeof o.metric !== "string" || !METRICS.includes(o.metric as Metric)) return { ok: false, reason: "invalid metric" };
    const args: AggregateArgs = { metric: o.metric as Metric };
    if (o.stale_days !== undefined) {
      const n = o.stale_days;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 365) return { ok: false, reason: "invalid stale_days" };
      args.stale_days = Math.floor(n);
    }
    if (args.metric === "stale_clients" && args.stale_days === undefined) return { ok: false, reason: "stale_clients requires stale_days" };
    return { ok: true, args };
  },
  async run(args, rc): Promise<ReadToolResult> {
    switch (args.metric) {
      case "clients_by_status": {
        const { rows, total } = await loadClients(rc);
        const by = new Map<string, number>();
        for (const c of rows) by.set(c.status, (by.get(c.status) ?? 0) + 1);
        const lines = [`clients by status (total ${total}):`];
        for (const s of CLIENT_STATUSES) if (by.has(s)) lines.push(`- ${s}: ${by.get(s)}`);
        return { content: lines.join("\n"), total, shown: rows.length, truncated: total > rows.length, domains: ["clients"] };
      }
      case "open_tasks":
      case "overdue_tasks":
      case "tasks_due_today": {
        let q = rc.supabase.from("tasks").select("id", { count: "exact", head: true }).not("status", "in", OPEN_TASK_EXCLUDED).is("deleted_at", null);
        if (args.metric === "overdue_tasks") q = q.lt("due_date", ymd(rc));
        if (args.metric === "tasks_due_today") q = q.eq("due_date", ymd(rc));
        const { count } = await q;
        const label = args.metric.replace(/_/g, " ");
        return { content: `${label}: ${count ?? 0}`, total: count ?? 0, shown: count ?? 0, truncated: false, domains: ["tasks"] };
      }
      case "incomplete_onboarding": {
        const set = await clientsIncompleteOnboarding(rc);
        return { content: `clients with incomplete onboarding (a submission not yet submitted/approved): ${set.size}`, total: set.size, shown: set.size, truncated: false, domains: ["onboarding"] };
      }
      case "unpaid_invoices": {
        // Per-currency sums — NEVER combined. Currency comes only from the authoritative row.
        const { data, count } = await rc.supabase.from("client_invoices").select("amount, currency", { count: "exact" }).eq("status", "sent").limit(SIGNAL_ROW_CAP);
        const byCur = new Map<string, { count: number; total: number }>();
        let unknownCur = 0;
        for (const r of data ?? []) {
          const cur = typeof r.currency === "string" && r.currency ? r.currency : null;
          if (!cur) { unknownCur++; continue; }
          const amt = Number(r.amount) || 0;
          const cell = byCur.get(cur) ?? { count: 0, total: 0 };
          cell.count++; cell.total += amt; byCur.set(cur, cell);
        }
        const total = count ?? (data?.length ?? 0);
        const lines = [`unpaid (sent) invoices: ${total}`];
        for (const [cur, cell] of [...byCur.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          lines.push(`- ${cur}: ${cell.count} invoice(s), outstanding ${cur} ${cell.total} (per-currency — do NOT combine currencies)`);
        }
        if (unknownCur > 0) lines.push(`- ${unknownCur} invoice(s) with no stated currency — not summed, do not assume a currency`);
        return { content: lines.join("\n"), total, shown: (data?.length ?? 0), truncated: total > (data?.length ?? 0), domains: ["invoices"] };
      }
      case "stage_distribution": {
        const { data, count } = await rc.supabase.from("project_stages").select("status", { count: "exact" }).limit(SIGNAL_ROW_CAP);
        const by = new Map<string, number>();
        for (const r of data ?? []) by.set(String(r.status), (by.get(String(r.status)) ?? 0) + 1);
        const lines = [`project stages by status (total ${count ?? 0}):`];
        for (const [s, n] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${s}: ${n}`);
        return { content: lines.join("\n"), total: count ?? 0, shown: data?.length ?? 0, truncated: (count ?? 0) > (data?.length ?? 0), domains: ["project_stages"] };
      }
      case "stale_clients": {
        const { rows, total } = await loadClients(rc);
        const latest = await latestUpdateByClient(rc);
        const cutoff = rc.now().getTime() - (args.stale_days ?? 0) * 86_400_000;
        const stale = rows.filter((c) => {
          const at = latest.get(c.id);
          return !at || new Date(at).getTime() < cutoff;
        });
        return {
          content: `clients with no client update in the last ${args.stale_days} day(s): ${stale.length} of ${total}`,
          total: stale.length,
          shown: stale.length,
          truncated: false,
          domains: ["clients", "updates"],
        };
      }
    }
  },
};
