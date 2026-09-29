import "server-only";

/**
 * Jarvis Intelligence — the trusted, MODEL-FACING action catalog.
 *
 * The diagnostic root cause: the model was told the `proposed_intent` SHAPE but never
 * the catalog of actions it may actually propose, so it guessed capability ids/schema
 * and conversationally pre-confirmed instead of emitting `proposed_intent`. This
 * module renders a small, trusted catalog into the system prompt.
 *
 * SECURITY: this is ADVISORY information for the model, NOT a security boundary. The
 * enforcement chain is unchanged and authoritative: model proposed_intent → strict
 * response validation → Intelligence allowlist → fail-closed arg envelope → F1 policy
 * → pending proposal → human approval → reauthorization → execution. The catalog
 * cannot grant authority; a capability appearing here is still fully re-validated.
 *
 * NO DRIFT: the set of exposed capability ids and their argument KEYS are derived
 * from the SAME `./action-allowlist` the bridge enforces (never re-declared here), so
 * the catalog can never advertise a non-allowlisted capability or an arg key outside
 * the fail-closed envelope. Only the human-readable purpose/constraint copy is local.
 */
import { INTELLIGENCE_ACTION_ALLOWLIST, ALLOWED_ARG_KEYS } from "./action-allowlist";

/** Human-readable copy for one model-facing action. The capability id and its allowed
 *  argument KEYS are NOT declared here — they come from the enforcement layer. */
interface ActionCopy {
  purpose: string;
  /** Human constraints on the argument values (the KEY SET is rendered from the envelope). */
  argConstraints: string;
}

/**
 * The capabilities surfaced to the model, in display order. EVERY id here MUST be in
 * `INTELLIGENCE_ACTION_ALLOWLIST` (asserted at load + in tests). V1 surfaces only the
 * title-only propose-task write action; the allowlisted read capabilities are not
 * advertised as things to propose conversationally.
 */
const MODEL_FACING_ACTION_IDS: readonly string[] = ["portal.propose_internal_task"];

const ACTION_COPY: Readonly<Record<string, ActionCopy>> = {
  "portal.propose_internal_task": {
    purpose: "Propose creating an internal task in the Planner Inbox.",
    argConstraints: "title must be trimmed, non-empty, and at most 200 characters. No other fields are supported.",
  },
};

// Fail-closed at module load: a surfaced action MUST be Intelligence-allowlisted and
// MUST have copy. Guards against an accidental edit; the parity tests assert the same.
for (const id of MODEL_FACING_ACTION_IDS) {
  if (!INTELLIGENCE_ACTION_ALLOWLIST.has(id)) throw new Error(`action-catalog: "${id}" is not Intelligence-allowlisted`);
  if (!ACTION_COPY[id]) throw new Error(`action-catalog: "${id}" has no model-facing copy`);
}

export const MODEL_FACING_ACTIONS: readonly string[] = MODEL_FACING_ACTION_IDS;

/** The exact allowed top-level arg keys for a surfaced action, taken (never re-declared)
 *  from the fail-closed enforcement envelope. Sorted for deterministic rendering/tests. */
export function allowedArgKeysFor(capabilityId: string): string[] {
  return [...(ALLOWED_ARG_KEYS[capabilityId] ?? new Set<string>())].sort();
}

function renderArgs(capabilityId: string): string {
  const keys = allowedArgKeysFor(capabilityId);
  // Every currently-surfaced argument is a string; render the exact permitted key set.
  return keys.length === 0 ? "{} (no arguments)" : `{ ${keys.map((k) => `${k}: string`).join(", ")} }`;
}

/**
 * Render the trusted model-facing action catalog as system-prompt text. Deterministic.
 * Explains that `proposed_intent` is a PROPOSAL (not execution), that the human
 * approves it afterward on a card, and that the model should therefore emit
 * `proposed_intent` DIRECTLY when the request already satisfies an available action —
 * without asking for redundant conversational confirmation and without inventing
 * unsupported arguments.
 */
export function buildActionCatalog(): string {
  const lines: string[] = [];
  lines.push(
    "AVAILABLE ACTIONS you may propose via proposed_intent. These are the ONLY capabilities you may propose — never invent a capability_id or arguments outside this list."
  );
  lines.push(
    "Emitting proposed_intent is a PROPOSAL ONLY; it does NOT execute the action. Trusted code creates a pending proposal and the human approves or rejects it afterward on an approval card. So when the user's request already provides what an available action requires, emit proposed_intent DIRECTLY in the same reply — do NOT ask for conversational confirmation merely to create the proposal, and do NOT invent unsupported fields. Ask a brief clarifying question ONLY when an argument the action requires is genuinely missing or ambiguous."
  );
  for (const id of MODEL_FACING_ACTION_IDS) {
    const copy = ACTION_COPY[id];
    lines.push(`- capability_id "${id}": ${copy.purpose} args ${renderArgs(id)} — ${copy.argConstraints}`);
  }
  return lines.join("\n");
}
