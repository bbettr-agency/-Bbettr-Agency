/**
 * Jarvis Memory V1 — deterministic ingestion / promotion policy (pure, no I/O).
 *
 * Decides what happens to a CANDIDATE memory BEFORE it is persisted. No LLM is
 * involved (Part 12). It is deliberately conservative: automatic acceptance as
 * active truth (`observed`) is NARROW; everything uncertain becomes `proposed`
 * and requires the human confirmation path; model-derived content is `inferred`
 * (never auto-truth); prohibited secrets and attempts to store Portal-owned
 * operational values are rejected outright.
 */
import { scanMemoryContent, type SecretCategory } from "./secrets";
import type { MemoryCreateState } from "./state-machine";
import type { MemoryCategory, MemorySourceKind } from "./types";

export interface IngestionInput {
  category: MemoryCategory;
  sourceKind: MemorySourceKind;
  claim: string;
  body?: string | null;
  structured?: unknown;
  /** Caller explicitly marks the content as secret → always rejected. */
  declaredSecret?: boolean;
  /** The supplying principal holds confirmation authority (a founder/approver). */
  supplierHasApproveAuthority: boolean;
  /**
   * Caller has determined this candidate is trying to assert a value that Portal
   * already OWNS as operational truth (e.g. a retainer amount, task status). Such
   * a candidate must not become competing memory.
   */
  assertsPortalOwnedValue?: boolean;
}

export type IngestionDecision =
  | { decision: "reject"; reason: string; secretCategories?: SecretCategory[] }
  | { decision: "store"; state: MemoryCreateState; reason: string };

/**
 * Categories whose objective, founder-stated content is safe to auto-accept as
 * `observed`. `decision` and `commitment` are excluded — they carry obligations
 * and must be explicitly confirmed.
 */
const SAFE_AUTO_CATEGORIES: ReadonlySet<MemoryCategory> = new Set([
  "company_knowledge",
  "preference_rule",
  "context_note",
  "client_knowledge",
]);

/** Objective source kinds (a human stated it, or it came from a record/event). */
const OBJECTIVE_SOURCES: ReadonlySet<MemorySourceKind> = new Set([
  "human_statement",
  "portal_record",
  "system_event",
]);

export function decideIngestion(input: IngestionInput): IngestionDecision {
  // 1. Secrets are rejected outright (fail-closed); never persist the content.
  const secret = scanMemoryContent({
    claim: input.claim,
    body: input.body ?? null,
    structured: input.structured,
    declaredSecret: input.declaredSecret,
  });
  if (secret.blocked) {
    return { decision: "reject", reason: "prohibited_secret", secretCategories: secret.categories };
  }

  // 2. Never store a value Portal already owns as operational truth.
  if (input.assertsPortalOwnedValue) {
    return { decision: "reject", reason: "duplicates_portal_truth" };
  }

  // 3. Model-derived content is `inferred` — never auto-truth.
  if (input.sourceKind === "model_inference") {
    return { decision: "store", state: "inferred", reason: "model_inference_not_truth" };
  }

  // 4. NARROW auto-accept: an authorised human stated objective, durable, non-
  //    obligation content in a safe category.
  if (
    OBJECTIVE_SOURCES.has(input.sourceKind) &&
    input.supplierHasApproveAuthority &&
    SAFE_AUTO_CATEGORIES.has(input.category)
  ) {
    return { decision: "store", state: "observed", reason: "objective_authorised_human_statement" };
  }

  // 5. Everything else requires explicit human confirmation.
  return { decision: "store", state: "proposed", reason: "requires_confirmation" };
}
