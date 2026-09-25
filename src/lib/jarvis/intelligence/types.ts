/**
 * Jarvis Intelligence — shared types (Slice C). Pure (no I/O, no authority).
 *
 * These describe the orchestration boundary. The model only ever PROPOSES the
 * structured fields; trusted code validates them and (in Slice C) does NOT execute
 * intents or write memory. Provider/model/usage/provenance are TRUSTED-recorded,
 * never taken from model output.
 */
import type { MemoryCategory, MemoryScope } from "@/lib/jarvis/memory/types";

/** Deterministic context routing decision (the model never chooses this). */
export type ContextPlan =
  | { kind: "agency" }
  | { kind: "user" }
  | { kind: "client"; clientId: string; clientName: string }
  | { kind: "ambiguous_client"; candidates: { id: string; name: string }[] }
  | { kind: "unknown_client" };

/** The validated (NOT executed) proposed action shape. capability_id has ZERO
 *  authority in Slice C — the F1 bridge (Slice D) allowlists/executes. */
export interface ValidatedProposedIntent {
  capabilityId: string;
  args: Record<string, unknown>;
  rationale?: string;
}

/** The validated (NOT written) memory candidate. Trusted code binds entity/
 *  provenance/state in Slice D; the model supplies only these four fields. */
export interface ValidatedMemoryCandidate {
  scope: MemoryScope;
  category: MemoryCategory;
  claim: string;
  body?: string;
}

export interface ValidatedUncertainty {
  level: "low" | "medium" | "high";
  notes?: string;
}

/** The parsed, bounded assistant response (from untrusted model output). */
export interface ValidatedAssistantResponse {
  assistantMessage: string;
  reasoningSummary?: string;
  uncertainty?: ValidatedUncertainty;
  proposedIntent?: ValidatedProposedIntent;
  memoryCandidate?: ValidatedMemoryCandidate;
}

/** Trusted, bounded provenance recorded by the orchestrator (never model-claimed). */
export interface TrustedProvenance {
  contextKind: ContextPlan["kind"];
  clientId: string | null;
  historyMessages: number;
  contextMemoryCount: number;
  contextPortalFactCount: number;
}

export type TurnResult =
  | {
      ok: true;
      threadId: string;
      requestId: string;
      assistantMessage: string;
      /** Validated but NOT executed (Slice D executes). */
      proposedIntent?: ValidatedProposedIntent;
      /** Validated but NOT written (Slice D writes). */
      memoryCandidate?: ValidatedMemoryCandidate;
      uncertainty?: ValidatedUncertainty;
      clarification?: boolean;
      /** ok:true is only ever returned AFTER the assistant row is durably stored,
       *  so this is always true — stated explicitly for transactional honesty. */
      persisted: true;
    }
  | {
      ok: false;
      /** Safe machine reason for the caller/logs; never raw provider/secret text. */
      reason: string;
      /** Present once a thread exists (so the caller can keep the transcript). */
      threadId?: string;
      requestId?: string;
      /**
       * Whether the row this outcome describes was durably persisted:
       *  • the SAFE-ERROR row, for a provider/validation failure;
       *  • false when persistence ITSELF failed (reason "persist_failed").
       * We never claim a row was stored when the write threw.
       */
      persisted?: boolean;
    };
