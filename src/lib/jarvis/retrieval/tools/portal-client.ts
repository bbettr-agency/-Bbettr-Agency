import "server-only";

import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { DomainKey, EntityRef, RetrieverContext, RetrieverInput } from "../types";
import { PORTAL_OPERATIONAL_DOMAINS } from "../types";
import { resolveClientFromList, type ClientLike } from "../resolve/match";
import { planQuery } from "../plan/query-planner";
import { assembleClientEvidence } from "../assemble/client-intelligence";
import { serializeEvidencePackage, serializeDomainEvidence } from "../evidence/serialize";
import { RETRIEVER_REGISTRY } from "../retrievers/registry";
import type { ReadToolDescriptor, ReadToolResult } from "./types";

/**
 * Jarvis Milestone A — CLIENT-scoped Portal read tools.
 *
 * These REUSE Slice 1 verbatim — the resolver, the deterministic planner, the two-pass
 * assembler, the evidence serializer and the frozen retriever registry — so a client
 * question gets the SAME authoritative intelligence Slice 1 produces, just obtained via
 * a tool call. No second client-intelligence implementation is created here.
 */

const CLIENT_SCAN_CAP = 500;

async function loadClientList(rc: RetrieverContext): Promise<ClientLike[]> {
  const { data } = await rc.supabase.from("clients").select("id, name, company").limit(CLIENT_SCAN_CAP);
  return (data ?? []).map((c) => ({ id: c.id as string, name: ((c.name as string | null) ?? ""), company: (c.company as string | null) ?? null }));
}

/** Fetch a single client's canonical name BY ID under RLS (model-supplied id is only
 *  honoured if the principal may actually read that row — RLS enforces it). */
async function clientRefById(rc: RetrieverContext, clientId: string): Promise<EntityRef | null> {
  const { data } = await rc.supabase.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!data) return null;
  return { kind: "client", id: data.id as string, name: ((data.name as string | null) ?? "").trim() };
}

// ── portal_resolve_client ──────────────────────────────────────────────────────
interface ResolveArgs {
  query: string;
}
export const resolveClientTool: ReadToolDescriptor<ResolveArgs> = {
  name: "portal_resolve_client",
  scope: "client",
  requiredGrant: "portal.read",
  description:
    "Resolve a client name/phrase to canonical Portal client id(s) under RLS. Returns exactly one match, several candidates (ask the user which), or none (the client is not in the Portal). Always resolve a name to an id with this before calling client-scoped tools; never guess an id.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
  },
  parse(raw) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: "args must be an object" };
    const q = (raw as Record<string, unknown>).query;
    if (typeof q !== "string" || q.trim().length === 0 || q.length > 200) return { ok: false, reason: "invalid query" };
    return { ok: true, args: { query: q } };
  },
  async run(args, rc): Promise<ReadToolResult> {
    const clients = await loadClientList(rc);
    const res = resolveClientFromList(args.query, clients);
    if (res.status === "none") {
      return { content: `No Portal client matches "${redactIfSecret(args.query)}".`, total: 0, shown: 0, truncated: false, domains: ["clients"] };
    }
    if (res.status === "one") {
      const e = res.entity;
      return { content: `Resolved to: ${redactIfSecret(e.canonicalName)} [id: ${e.id}] (match: ${e.tier}).`, total: 1, shown: 1, truncated: false, domains: ["clients"] };
    }
    const lines = [`Multiple clients match "${redactIfSecret(args.query)}" — ask which:`];
    for (const c of res.candidates) lines.push(`- ${redactIfSecret(c.canonicalName)} [id: ${c.id}]`);
    return { content: lines.join("\n"), total: res.candidates.length, shown: res.candidates.length, truncated: false, domains: ["clients"] };
  },
};

// ── portal_get_client_overview (reuses Slice-1 assembler) ───────────────────────
interface OverviewArgs {
  client_id: string;
}
export const getClientOverviewTool: ReadToolDescriptor<OverviewArgs> = {
  name: "portal_get_client_overview",
  scope: "client",
  requiredGrant: "portal.read",
  description:
    "Full authoritative intelligence for ONE client (identity, services, stages, onboarding, updates, tasks, reports, contracts, invoices, payments, retainers, activity, weekly updates, deals, files + supplementary memory), bounded and secret-safe. This is the same evidence the deterministic client path produces. Pass a client_id from portal_resolve_client.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["client_id"],
    properties: { client_id: { type: "string", minLength: 1, maxLength: 64 } },
  },
  parse(raw) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: "args must be an object" };
    const id = (raw as Record<string, unknown>).client_id;
    if (typeof id !== "string" || id.trim().length === 0 || id.length > 64) return { ok: false, reason: "invalid client_id" };
    return { ok: true, args: { client_id: id } };
  },
  async run(args, rc): Promise<ReadToolResult> {
    const subject = await clientRefById(rc, args.client_id);
    if (!subject) {
      // RLS-safe: either not found or not readable — never assert existence.
      return { content: `No readable client with id "${args.client_id}".`, total: 0, shown: 0, truncated: false, domains: ["clients"] };
    }
    const plan = planQuery({ message: "", resolution: { status: "one", kind: "client", entity: { kind: "client", id: subject.id, canonicalName: subject.name, matchedOn: "name", tier: "exact", confidence: 1 } } });
    const pkg = await assembleClientEvidence(plan, rc);
    const content = serializeEvidencePackage(pkg, rc.now());
    const domains = pkg.portalAuthoritative.map((d) => d.domain);
    const truncated = pkg.portalAuthoritative.some((d) => d.truncated) || pkg.budget.droppedDomains.length > 0;
    return { content, total: domains.length, shown: domains.length, truncated, domains, degraded: pkg.answerConfidence !== "high" };
  },
};

// ── portal_get_client_domain (parameterised over the frozen registry) ───────────
// Only the 15 operational domains + memory are model-reachable here; PII/on-demand
// domains (billing_details, people, update_questions) are deliberately EXCLUDED.
const DOMAIN_TOOL_ENUM: DomainKey[] = [...PORTAL_OPERATIONAL_DOMAINS, "memory"];

interface DomainArgs {
  client_id: string;
  domain: DomainKey;
}
export const getClientDomainTool: ReadToolDescriptor<DomainArgs> = {
  name: "portal_get_client_domain",
  scope: "client",
  requiredGrant: "portal.read",
  description:
    "Detailed read of ONE domain for ONE client when the overview is not enough (e.g. all open tasks, or invoice detail). Pass a client_id from portal_resolve_client and a domain from the allowed list.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["client_id", "domain"],
    properties: {
      client_id: { type: "string", minLength: 1, maxLength: 64 },
      domain: { type: "string", enum: DOMAIN_TOOL_ENUM },
    },
  },
  parse(raw) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: "args must be an object" };
    const o = raw as Record<string, unknown>;
    if (typeof o.client_id !== "string" || o.client_id.trim().length === 0 || o.client_id.length > 64) return { ok: false, reason: "invalid client_id" };
    if (typeof o.domain !== "string" || !DOMAIN_TOOL_ENUM.includes(o.domain as DomainKey)) return { ok: false, reason: "invalid or non-allowed domain" };
    return { ok: true, args: { client_id: o.client_id, domain: o.domain as DomainKey } };
  },
  async run(args, rc): Promise<ReadToolResult> {
    const subject = await clientRefById(rc, args.client_id);
    if (!subject) return { content: `No readable client with id "${args.client_id}".`, total: 0, shown: 0, truncated: false, domains: ["clients"] };
    const descriptor = RETRIEVER_REGISTRY.get(args.domain);
    if (!descriptor) return { content: `Domain "${args.domain}" is not available.`, total: 0, shown: 0, truncated: false, domains: [] };
    const input: RetrieverInput = { entity: subject };
    const res = await descriptor.runDetail(input, rc);
    const content = serializeDomainEvidence(
      { domain: res.domain, authority: res.authority, status: res.status, phase: "detail", facts: res.facts, returnedCount: res.returnedCount, availableCount: res.availableCount, truncated: res.truncated, freshestAt: res.freshestAt },
      rc.now()
    );
    const degraded = res.status === "error" || res.status === "denied" || res.status === "unavailable";
    return { content, total: res.availableCount, shown: res.returnedCount, truncated: res.truncated, domains: [args.domain], degraded };
  },
};
