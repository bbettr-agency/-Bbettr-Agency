import type { JarvisContext } from "@/lib/jarvis/identity";
import type { createClient } from "@/lib/supabase/server";

/**
 * Jarvis Retrieval V2 — shared, PURE type contracts (Slice 1: Client Intelligence).
 *
 * No I/O, no server-only: importable by tests. The retrieval pipeline is a
 * deterministic pre-pass (resolve → plan → retrieve → assemble → evidence) that
 * runs under the authenticated principal's RLS identity and feeds ONE provider
 * call. The model never chooses data, sees SQL, or supplies database ids.
 */

/** Authority class — Portal structured truth is authoritative over Memory. */
export type AuthorityClass = "portal_operational" | "memory" | "conversation" | "integration";

export type EntityKind = "client" | "person" | "project";

export interface EntityRef {
  kind: EntityKind;
  id: string;
  name: string;
}

// ── Entity resolution ────────────────────────────────────────────────────────
export type MatchTier = "exact" | "normalized" | "all_tokens" | "prefix" | "substring";

export interface EntityCandidate {
  kind: EntityKind;
  id: string;
  canonicalName: string;
  matchedOn: "name" | "company";
  tier: MatchTier;
  confidence: number;
}

export type EntityResolution =
  | { status: "none"; kind: EntityKind; query: string }
  | { status: "one"; kind: EntityKind; entity: EntityCandidate }
  | { status: "many"; kind: EntityKind; candidates: EntityCandidate[] };

// ── Query planner ────────────────────────────────────────────────────────────
export type QueryIntent =
  | "client_detail" // broad overview
  | "client_subdomain" // focused
  | "client_discovery"
  | "memory_decision"
  | "clarify"
  | "unresolved"
  | "agency_overview" // FUTURE (contract only)
  | "person_workload" // FUTURE
  | "timeline_change" // FUTURE
  | "aggregation" // FUTURE
  | "multi_client_compare" // FUTURE
  | "agency_fallback";

export type SubdomainFocus =
  | "tasks"
  | "reports"
  | "files"
  | "financial"
  | "onboarding"
  | "updates"
  | "questions"
  | "contact";

/** The 15 Portal operational domains + the separate Memory domain + on-demand ones. */
export type DomainKey =
  // 15 Portal operational (Pass A always):
  | "client_identity"
  | "client_services"
  | "project_stages"
  | "onboarding"
  | "updates"
  | "tasks"
  | "reports"
  | "contracts"
  | "invoices"
  | "payments"
  | "retainers"
  | "activity"
  | "weekly_updates"
  | "deals"
  | "files"
  // Separate supplementary domain:
  | "memory"
  // On-demand (PII / sensitivity) — never in Pass A:
  | "billing_details"
  | "update_questions"
  | "people";

/** The 15 Portal operational domains that are ALWAYS represented in a broad Pass A. */
export const PORTAL_OPERATIONAL_DOMAINS: readonly DomainKey[] = [
  "client_identity",
  "client_services",
  "project_stages",
  "onboarding",
  "updates",
  "tasks",
  "reports",
  "contracts",
  "invoices",
  "payments",
  "retainers",
  "activity",
  "weekly_updates",
  "deals",
  "files",
] as const;

export interface RetrieverInvocation {
  domain: DomainKey;
  phase: "summary" | "detail";
  detailLimit?: number;
  budgetTokens: number;
  priority: number;
}

export interface RetrievalPlan {
  intent: QueryIntent;
  mode: "broad" | "focused" | "discovery" | "agency_fallback" | "none";
  subject: EntityRef | null;
  focus: SubdomainFocus[];
  passA: RetrieverInvocation[];
  passB: RetrieverInvocation[];
  clarify?: { candidates: EntityCandidate[] };
  unresolvedQuery?: string;
  supported: boolean;
}

// ── Retrievers ───────────────────────────────────────────────────────────────
export type RlsServerClient = Awaited<ReturnType<typeof createClient>>;

export type RetrieverStatus = "ok" | "empty" | "error" | "denied" | "unavailable" | "truncated";

export interface RetrieverContext {
  ctx: JarvisContext;
  supabase: RlsServerClient;
  /** Injectable clock (deterministic in tests). */
  now: () => Date;
}

export interface RetrieverInput {
  /** The resolved subject (id + name), sourced only from the RLS-authorized resolver. */
  entity: EntityRef;
  detailLimit?: number;
}

export interface EvidenceFact {
  domain: DomainKey;
  authority: AuthorityClass;
  entity: EntityRef;
  label: string;
  value: unknown;
  occurredAt?: string | null;
  source: string;
  /** INTERNAL provenance (table:id). Never rendered into provider context. */
  recordRef?: string;
  partial?: boolean;
}

export interface RetrieverResult {
  domain: DomainKey;
  authority: AuthorityClass;
  status: RetrieverStatus;
  facts: EvidenceFact[];
  returnedCount: number;
  availableCount: number | null;
  truncated: boolean;
  freshestAt: string | null;
  error?: string;
  tookMs: number;
}

export interface RetrieverDescriptor {
  domain: DomainKey;
  authority: AuthorityClass;
  authorization: "rls_principal";
  runSummary(input: RetrieverInput, rc: RetrieverContext): Promise<RetrieverResult>;
  runDetail(input: RetrieverInput, rc: RetrieverContext): Promise<RetrieverResult>;
}

// ── Evidence package ─────────────────────────────────────────────────────────
export interface DomainEvidence {
  domain: DomainKey;
  authority: AuthorityClass;
  status: RetrieverStatus;
  phase: "summary" | "detail";
  facts: EvidenceFact[];
  returnedCount: number;
  availableCount: number | null;
  truncated: boolean;
  freshestAt: string | null;
}

export interface BudgetReport {
  totalBudgetTokens: number;
  estimatedTokens: number;
  droppedDomains: DomainKey[];
  clippedDomains: DomainKey[];
}

export interface EvidencePackage {
  generatedAt: string;
  intent: QueryIntent;
  mode: RetrievalPlan["mode"];
  subject: EntityRef | null;
  /** Class 1/5 — authoritative Portal truth. */
  portalAuthoritative: DomainEvidence[];
  /** Class 2 — supplementary memory (kept separate). */
  memory: DomainEvidence[];
  domainStatus: Record<string, RetrieverStatus>;
  budget: BudgetReport;
}

// ── Observability (safe: counts/ids/status/sizes only) ───────────────────────
export interface RetrievalTrace {
  requestId: string;
  mode: RetrievalPlan["mode"];
  intent: QueryIntent;
  resolution: {
    status: "none" | "one" | "many";
    tier?: MatchTier;
    candidateCount?: number;
    resolvedClientId?: string;
  };
  passA: { domainsCovered: DomainKey[]; estTokens: number };
  passB: { domainsDetailed: DomainKey[]; domainsDetailOmitted: DomainKey[]; estTokens: number };
  memory: { count: number; estTokens: number };
  retrievers: Array<{
    domain: DomainKey;
    phase: "summary" | "detail";
    status: RetrieverStatus;
    returned: number;
    available: number | null;
    truncated: boolean;
    tookMs: number;
  }>;
  evidence: { estTokensTotal: number; evidenceCeilingHit: boolean };
  history: { turnsIncluded: number; estTokens: number; reducedFromTarget: boolean };
  promptInputEstTokens: number;
  totalMs: number;
}

export type { JarvisContext };
