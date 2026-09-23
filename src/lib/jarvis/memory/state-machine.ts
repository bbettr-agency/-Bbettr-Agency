/**
 * Jarvis Memory V1 — deterministic state machine (pure, no I/O).
 *
 * The application layer MUST route every lifecycle change through this decider.
 * Critical invariants (Part 4):
 *   • `inferred` may NEVER silently become `confirmed` — confirmation is an
 *     explicit transition that REQUIRES human approval authority.
 *   • `proposed` may NEVER become `confirmed` without that same authority.
 *   • `superseded` / `retired` / `rejected` are terminal (no way back to truth).
 *   • a `rejected` candidate is never treated as truth.
 *   • corrections never overwrite — they SUPERSEDE (the old row → superseded,
 *     current=false) while a new row is created (handled by the store layer).
 *
 * The model (a future LLM) can PROPOSE, but only these deterministic rules move
 * a memory into the active truth set.
 */
import { isActiveTruthState, type MemoryState } from "./types";

/** The states a brand-new memory may be created in (never confirmed/rejected/…). */
export type MemoryCreateState = "observed" | "inferred" | "proposed";
export const MEMORY_CREATE_STATES: readonly MemoryCreateState[] = ["observed", "inferred", "proposed"];
export const isMemoryCreateState = (v: unknown): v is MemoryCreateState =>
  MEMORY_CREATE_STATES.includes(v as MemoryCreateState);

/** The lifecycle transitions an authorised human may apply to an existing memory. */
export type MemoryTransition = "confirm" | "reject" | "supersede" | "retire";

export interface TransitionInput {
  from: MemoryState;
  transition: MemoryTransition;
  /** The acting principal holds memory-confirmation authority (e.g. jarvis.approve). */
  hasApproveAuthority: boolean;
}

export type TransitionDecision =
  | { ok: true; to: MemoryState; current: boolean }
  | { ok: false; reason: string };

const TERMINAL: ReadonlySet<MemoryState> = new Set(["superseded", "retired", "rejected"]);

/** Legal `from` states per transition (before the authority check). */
const LEGAL_FROM: Record<MemoryTransition, ReadonlySet<MemoryState>> = {
  confirm: new Set(["observed", "inferred", "proposed"]),
  reject: new Set(["proposed", "inferred"]),
  supersede: new Set(["observed", "confirmed", "inferred"]),
  retire: new Set(["observed", "confirmed", "inferred"]),
};

/** Every lifecycle transition here is a founder-level curation act. */
function requiresAuthority(_t: MemoryTransition): boolean {
  return true;
}

/**
 * The `current` flag a NEW memory should carry given its creation state:
 * observed ⇒ active truth (current); inferred/proposed ⇒ not-yet-truth.
 */
export function currentOnCreate(state: MemoryCreateState): boolean {
  return isActiveTruthState(state);
}

/** Decide a single lifecycle transition. Pure and fail-closed. */
export function decideTransition(input: TransitionInput): TransitionDecision {
  const { from, transition, hasApproveAuthority } = input;

  if (TERMINAL.has(from)) {
    return { ok: false, reason: `terminal_state:${from}` };
  }
  const legal = LEGAL_FROM[transition];
  if (!legal || !legal.has(from)) {
    return { ok: false, reason: `illegal_transition:${from}->${transition}` };
  }
  if (requiresAuthority(transition) && !hasApproveAuthority) {
    // inferred/proposed can NEVER reach confirmed (and no memory can be
    // superseded/retired/rejected) without explicit human authority.
    return { ok: false, reason: "requires_approval_authority" };
  }

  switch (transition) {
    case "confirm":
      return { ok: true, to: "confirmed", current: true };
    case "reject":
      return { ok: true, to: "rejected", current: false };
    case "supersede":
      return { ok: true, to: "superseded", current: false };
    case "retire":
      return { ok: true, to: "retired", current: false };
    default:
      return { ok: false, reason: "unknown_transition" };
  }
}
