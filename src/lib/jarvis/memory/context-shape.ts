/**
 * Jarvis Context Engine — pure shaping (no I/O, no LLM).
 *
 * Deterministically assembles a BOUNDED, TYPED, PROVENANCE-AWARE ContextPackage
 * that keeps AUTHORITATIVE PORTAL FACTS separate from durable Jarvis MEMORY, and
 * surfaces open commitments and unresolved conflicts. Ranking is deterministic
 * (importance, then recency) — never an LLM. The server layer (context-engine.ts)
 * fetches the inputs under RLS and calls these pure functions, so the shaping is
 * unit-testable without a database.
 */
import type { MemoryCategory, MemoryScope } from "./types";

/** Read-model summary of a memory row (shared by reads.ts and the shaper). */
export interface MemorySummary {
  id: string;
  scope: MemoryScope;
  clientId: string | null;
  userId: string | null;
  category: MemoryCategory;
  claim: string;
  importance: number;
  state: string;
  current: boolean;
  sourceKind: string;
  sourceRef: string | null;
  observedAt: string;
  suppliedDisplay: string | null;
  confirmedAt: string | null;
  conflictsWithId: string | null;
  supersedesId: string | null;
  supersededById: string | null;
}

export interface ContextProvenance {
  sourceKind: string;
  sourceRef: string | null;
  observedAt: string;
  suppliedDisplay: string | null;
  state: string;
  confirmedAt: string | null;
}

export interface ContextMemoryItem {
  id: string;
  category: MemoryCategory;
  claim: string;
  importance: number;
  conflictsWithId: string | null;
  provenance: ContextProvenance;
}

/** One authoritative Portal fact, tagged with the table/column it came from. */
export interface PortalFact {
  key: string;
  label: string;
  value: unknown;
  /** Authoritative source, e.g. "clients.status" or "client_services". */
  source: string;
}

export interface PortalSection {
  title: string;
  facts: PortalFact[];
}

export interface ContextPackage {
  kind: "client" | "agency" | "user";
  subjectId: string | null;
  generatedAt: string;
  /** Authoritative operational truth from Portal (never duplicated into memory). */
  portal: { authoritative: true; sections: PortalSection[] };
  /** Durable non-operational Jarvis memory (current, non-commitment). */
  memory: ContextMemoryItem[];
  /** Current commitments (obligations) surfaced separately. */
  openCommitments: ContextMemoryItem[];
  /** Current memories carrying an unresolved conflict flag. */
  unresolvedConflicts: ContextMemoryItem[];
  caps: Record<string, number>;
  truncated: Record<string, boolean>;
}

export interface ContextCaps {
  memory: number;
  commitments: number;
  conflicts: number;
}

export const DEFAULT_CONTEXT_CAPS: ContextCaps = { memory: 20, commitments: 15, conflicts: 15 };

function toItem(m: MemorySummary): ContextMemoryItem {
  return {
    id: m.id,
    category: m.category,
    claim: m.claim,
    importance: m.importance,
    conflictsWithId: m.conflictsWithId,
    provenance: {
      sourceKind: m.sourceKind,
      sourceRef: m.sourceRef,
      observedAt: m.observedAt,
      suppliedDisplay: m.suppliedDisplay,
      state: m.state,
      confirmedAt: m.confirmedAt,
    },
  };
}

/** Deterministic ordering: importance desc, then most-recently observed. */
function rank(a: MemorySummary, b: MemorySummary): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return b.observedAt.localeCompare(a.observedAt);
}

/**
 * Classify + bound a set of memory rows. Only ACTIVE-TRUTH (`current`) rows are
 * ever included — superseded/retired/rejected/proposed/inferred are excluded by
 * default retrieval. Commitments and conflicts are pulled into their own bounded
 * lists; the remainder is the general memory list.
 */
export function shapeMemoryContext(
  rows: MemorySummary[],
  caps: ContextCaps = DEFAULT_CONTEXT_CAPS
): Pick<ContextPackage, "memory" | "openCommitments" | "unresolvedConflicts" | "truncated"> {
  const current = rows.filter((r) => r.current);

  const conflictsAll = current.filter((r) => r.conflictsWithId).sort(rank);
  const commitmentsAll = current.filter((r) => r.category === "commitment").sort(rank);
  const generalAll = current
    .filter((r) => r.category !== "commitment" && !r.conflictsWithId)
    .sort(rank);

  return {
    memory: generalAll.slice(0, caps.memory).map(toItem),
    openCommitments: commitmentsAll.slice(0, caps.commitments).map(toItem),
    unresolvedConflicts: conflictsAll.slice(0, caps.conflicts).map(toItem),
    truncated: {
      memory: generalAll.length > caps.memory,
      commitments: commitmentsAll.length > caps.commitments,
      conflicts: conflictsAll.length > caps.conflicts,
    },
  };
}

export function buildContextPackage(input: {
  kind: "client" | "agency" | "user";
  subjectId: string | null;
  generatedAt: string;
  portalSections: PortalSection[];
  memories: MemorySummary[];
  caps?: ContextCaps;
}): ContextPackage {
  const caps = input.caps ?? DEFAULT_CONTEXT_CAPS;
  const shaped = shapeMemoryContext(input.memories, caps);
  return {
    kind: input.kind,
    subjectId: input.subjectId,
    generatedAt: input.generatedAt,
    portal: { authoritative: true, sections: input.portalSections },
    memory: shaped.memory,
    openCommitments: shaped.openCommitments,
    unresolvedConflicts: shaped.unresolvedConflicts,
    caps: { memory: caps.memory, commitments: caps.commitments, conflicts: caps.conflicts },
    truncated: shaped.truncated,
  };
}
