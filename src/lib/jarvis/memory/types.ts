/**
 * Jarvis Memory V1 — shared pure types (no I/O).
 *
 * Memory stores durable, NON-operational knowledge with provenance and a
 * lifecycle. Portal remains the authoritative source of structured operational
 * truth; memory never duplicates it. The LLM is NOT connected here — these types
 * describe the deterministic layer a future model will plug into as a proposer.
 */

/** Where a memory belongs. `client` = internal memory ABOUT a client (NOT client-readable). */
export type MemoryScope = "agency" | "client" | "user";

/** Deliberately small category set (Part 3). */
export type MemoryCategory =
  | "company_knowledge"
  | "client_knowledge"
  | "decision"
  | "commitment"
  | "preference_rule"
  | "context_note";

/**
 * Lifecycle state. `observed`/`confirmed` are active truth; `inferred`/`proposed`
 * are not-yet-truth; `superseded`/`retired`/`rejected` are historical/inactive.
 */
export type MemoryState =
  | "observed"
  | "inferred"
  | "proposed"
  | "confirmed"
  | "superseded"
  | "retired"
  | "rejected";

/** How the memory came to be known (provenance). */
export type MemorySourceKind =
  | "human_statement"
  | "portal_record"
  | "document"
  | "system_event"
  | "model_inference";

/** Append-only lineage event types. */
export type MemoryEventType =
  | "created"
  | "confirmed"
  | "superseded"
  | "corrected"
  | "conflict_flagged"
  | "retired"
  | "rejected"
  | "redacted";

export const MEMORY_SCOPES: readonly MemoryScope[] = ["agency", "client", "user"] as const;
export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "company_knowledge",
  "client_knowledge",
  "decision",
  "commitment",
  "preference_rule",
  "context_note",
] as const;
export const MEMORY_STATES: readonly MemoryState[] = [
  "observed",
  "inferred",
  "proposed",
  "confirmed",
  "superseded",
  "retired",
  "rejected",
] as const;
export const MEMORY_SOURCE_KINDS: readonly MemorySourceKind[] = [
  "human_statement",
  "portal_record",
  "document",
  "system_event",
  "model_inference",
] as const;

/** A state that is part of the ACTIVE truth set (returned by default retrieval). */
export function isActiveTruthState(state: MemoryState): boolean {
  return state === "observed" || state === "confirmed";
}

export const isMemoryScope = (v: unknown): v is MemoryScope => MEMORY_SCOPES.includes(v as MemoryScope);
export const isMemoryCategory = (v: unknown): v is MemoryCategory =>
  MEMORY_CATEGORIES.includes(v as MemoryCategory);
export const isMemoryState = (v: unknown): v is MemoryState => MEMORY_STATES.includes(v as MemoryState);
export const isMemorySourceKind = (v: unknown): v is MemorySourceKind =>
  MEMORY_SOURCE_KINDS.includes(v as MemorySourceKind);
