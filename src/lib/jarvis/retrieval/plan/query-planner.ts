import type { DomainKey, EntityCandidate, EntityRef, EntityResolution, QueryIntent, RetrievalPlan, RetrieverInvocation, SubdomainFocus } from "../types";
import { PORTAL_OPERATIONAL_DOMAINS } from "../types";
import { DOMAIN_CONFIG } from "../domain-config";
import {
  detectFocus,
  detectFuture,
  hasClientReferenceCue,
  isDiscovery,
  isMemoryDecision,
  FOCUS_DOMAINS,
  FOCUSED_SUPPORT_SUMMARY,
  type FutureIntent,
} from "./intents";

/**
 * Jarvis Retrieval V2 — deterministic query planner (PURE, no LLM, no I/O).
 * Classifies the information need and emits the Pass-A / Pass-B retriever plan.
 * The model never influences this; a resolved subject id comes only from the
 * (RLS-authorized) entity resolver, never from the model.
 */

function toRef(c: EntityCandidate): EntityRef {
  return { kind: "client", id: c.id, name: c.canonicalName };
}

function summaryInv(domain: DomainKey): RetrieverInvocation {
  const cfg = DOMAIN_CONFIG[domain];
  return { domain, phase: "summary", budgetTokens: cfg.summaryTokens, priority: cfg.priority };
}
function detailInv(domain: DomainKey, priorityOverride?: number): RetrieverInvocation {
  const cfg = DOMAIN_CONFIG[domain];
  return {
    domain,
    phase: "detail",
    detailLimit: cfg.detailLimit,
    budgetTokens: cfg.detailTokens,
    priority: priorityOverride ?? cfg.priority,
  };
}

function dedupeByDomain(invs: RetrieverInvocation[]): RetrieverInvocation[] {
  const seen = new Set<DomainKey>();
  const out: RetrieverInvocation[] = [];
  for (const i of invs) {
    if (seen.has(i.domain)) continue;
    seen.add(i.domain);
    out.push(i);
  }
  return out;
}

function broadPlan(intent: "client_detail" | "memory_decision", subject: EntityRef): RetrievalPlan {
  const passADomains: DomainKey[] = [...PORTAL_OPERATIONAL_DOMAINS, "memory"];
  const passA = dedupeByDomain(passADomains.map(summaryInv));
  const memPriority = intent === "memory_decision" ? 0 : DOMAIN_CONFIG.memory.priority;
  const passB = dedupeByDomain([...PORTAL_OPERATIONAL_DOMAINS.map((d) => detailInv(d)), detailInv("memory", memPriority)]).sort(
    (a, b) => a.priority - b.priority
  );
  return { intent, mode: "broad", subject, focus: [], passA, passB, supported: true };
}

function focusedPlan(subject: EntityRef, focus: SubdomainFocus[]): RetrievalPlan {
  const passADomains: DomainKey[] = [...FOCUSED_SUPPORT_SUMMARY, "memory"];
  const passA = dedupeByDomain(passADomains.map(summaryInv));
  const focusDomains: DomainKey[] = [];
  for (const f of focus) for (const d of FOCUS_DOMAINS[f]) if (!focusDomains.includes(d)) focusDomains.push(d);
  const passB = dedupeByDomain([
    detailInv("client_identity", 0),
    ...focusDomains.map((d) => detailInv(d)),
    detailInv("memory"),
  ]).sort((a, b) => a.priority - b.priority);
  return { intent: "client_subdomain", mode: "focused", subject, focus, passA, passB, supported: true };
}

function discoveryPlan(): RetrievalPlan {
  return { intent: "client_discovery", mode: "discovery", subject: null, focus: [], passA: [], passB: [], supported: true };
}
function agencyFallbackPlan(): RetrievalPlan {
  return {
    intent: "agency_fallback",
    mode: "agency_fallback",
    subject: null,
    focus: [],
    passA: [summaryInv("memory")],
    passB: [detailInv("memory")],
    supported: true,
  };
}
function clarifyPlan(candidates: EntityCandidate[]): RetrievalPlan {
  return { intent: "clarify", mode: "none", subject: null, focus: [], passA: [], passB: [], clarify: { candidates }, supported: true };
}
function unresolvedPlan(message: string): RetrievalPlan {
  return { intent: "unresolved", mode: "none", subject: null, focus: [], passA: [], passB: [], unresolvedQuery: message, supported: true };
}
function unsupportedPlan(intent: FutureIntent): RetrievalPlan {
  return { intent: intent as QueryIntent, mode: "none", subject: null, focus: [], passA: [], passB: [], supported: false };
}

export function planQuery(args: { message: string; resolution: EntityResolution }): RetrievalPlan {
  const { message, resolution } = args;

  // Discovery is distinct from single-client resolution.
  if (isDiscovery(message)) return discoveryPlan();

  if (resolution.status === "one") {
    const subject = toRef(resolution.entity);
    if (isMemoryDecision(message)) return broadPlan("memory_decision", subject);
    const focus = detectFocus(message);
    if (focus.length > 0) return focusedPlan(subject, focus);
    return broadPlan("client_detail", subject);
  }

  if (resolution.status === "many") {
    if (detectFuture(message) === "multi_client_compare") return unsupportedPlan("multi_client_compare");
    return clarifyPlan(resolution.candidates);
  }

  // none
  const fut = detectFuture(message);
  if (fut) return unsupportedPlan(fut);
  if (hasClientReferenceCue(message)) return unresolvedPlan(message);
  return agencyFallbackPlan();
}
