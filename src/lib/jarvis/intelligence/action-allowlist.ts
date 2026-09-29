/**
 * Jarvis Intelligence — the SINGLE SOURCE OF TRUTH for which capabilities the model
 * may propose, and the exact top-level argument keys permitted per capability.
 *
 * A pure leaf module (no I/O, no executor imports) so both the trusted enforcement
 * layer (the action bridge) AND the model-facing action catalog derive from the SAME
 * values — the catalog can never advertise a capability that is not allowlisted, and
 * the model-facing argument keys can never drift from the fail-closed envelope the
 * bridge enforces. Changing enforcement here changes what the model is told, in
 * lockstep, and the parity tests fail if the two are ever wired to diverge.
 */

/**
 * The ONLY capabilities the model may propose conversationally. A capability
 * existing in the F1 registry is NOT sufficient — it must also be on this list.
 * `jarvis.ping` is intentionally excluded (internal diagnostic only).
 */
export const INTELLIGENCE_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "portal.read_task_counts",
  "portal.propose_internal_task",
  "integrations.read_deployment_state",
]);

/**
 * The EXACT permitted top-level arg keys per allowlisted capability, verified BEFORE
 * delegating to F1. Rationale: the frozen F1 parsers SILENTLY STRIP unknown keys
 * (e.g. a proposed `{title, due_date}` becomes `{title}`), which would change the
 * semantic meaning of an operational request. For Intelligence we want FAIL-CLOSED
 * semantics on untrusted model args. This is an ADDITIONAL trust-boundary guard; it
 * never replaces canonical F1 validation (which still runs afterward inside
 * invokeCapability). Kept in lockstep with the frozen capability parsers:
 *   • portal.read_task_counts            → no args
 *   • portal.propose_internal_task       → exactly { title }
 *   • integrations.read_deployment_state → optional { clientId } only
 */
export const ALLOWED_ARG_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  "portal.read_task_counts": new Set<string>(),
  "portal.propose_internal_task": new Set<string>(["title"]),
  "integrations.read_deployment_state": new Set<string>(["clientId"]),
};
