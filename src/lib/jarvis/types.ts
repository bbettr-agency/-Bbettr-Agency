/**
 * Jarvis Foundation 1 — shared types for the deterministic security kernel.
 * Pure (no I/O). The LLM is NOT connected in Foundation 1; these types describe
 * the authorization boundary the future model layer will plug into.
 */

/** How consequential a capability is — decides the execution path. */
export type RiskClass =
  | "auto" // may execute automatically once granted (internal, low-risk)
  | "confirm" // requires an authorised human to approve the exact effect
  | "destructive" // like confirm, but NEVER auto and always human-approved
  | "monitor"; // read/recommend only; must never mutate

/** Whether a capability acts on the agency itself or a specific client tenant. */
export type CapabilityScope = "agency" | "client";

/** Deterministic policy outcomes. */
export type PolicyOutcome = "allow" | "deny" | "needs_approval" | "monitor_only";

/**
 * Verification lifecycle. "reported" (a system said so) is NEVER "verified"
 * (independently confirmed with evidence). Missing verification ⇒ never success.
 */
export type VerificationState =
  | "not_required"
  | "pending"
  | "reported"
  | "verified"
  | "failed"
  | "unavailable";

/** Provenance of an action — NEVER a source of authority. */
export type ActorKind = "jarvis" | "human" | "system";
