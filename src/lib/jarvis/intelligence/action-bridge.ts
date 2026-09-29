import "server-only";

import { getCapability, type JarvisCapability } from "@/lib/jarvis/capabilities";
import { invokeCapability, type InvokeResult } from "@/lib/jarvis/dispatch";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan, ValidatedProposedIntent } from "./types";
import { INTELLIGENCE_ACTION_ALLOWLIST, ALLOWED_ARG_KEYS } from "./action-allowlist";

/**
 * Jarvis Intelligence — ACTION BRIDGE (Slice D, server-only).
 *
 * Turns an UNTRUSTED, Slice-C-validated `proposed_intent` into a request against
 * the EXISTING Foundation-1 trusted entry point (`invokeCapability`). The model's
 * capability_id/args carry ZERO authority: this bridge is a gate, not an executor.
 *
 * It does NOT re-implement F1. `invokeCapability` remains authoritative and
 * independently re-parses args, re-runs the deterministic policy (grant + scope),
 * audits the decision, and routes (auto read / monitor / needs_approval / deny).
 * The bridge only (1) enforces an Intelligence-specific allowlist on top of the
 * registry, (2) confirms the capability is canonically registered, and (3) maps
 * the trusted F1 result into a trusted bridge status. It never approves, never
 * executes a write directly, and never invents success.
 *
 * Reauthorization (TOCTOU): the caller (orchestrator) re-resolves the principal
 * at bridge time and passes a FRESH, consistency-checked JarvisContext here, so a
 * grant/workspace change between the model call and the bridge is honored.
 */

// The Intelligence allowlist + fail-closed arg envelope are the single source of
// truth in ./action-allowlist (shared with the model-facing action catalog so the
// two can never drift). Re-exported here for existing importers.
export { INTELLIGENCE_ACTION_ALLOWLIST } from "./action-allowlist";

/** Allowlisted read capabilities whose F1 "allow" outcome is a READ, not a write.
 *  No allowlisted capability is an auto-executed write, so a genuine immediate
 *  write execution CANNOT occur on the current conversational surface — hence the
 *  action result contract has NO `executed` state (it would be a state that can
 *  never honestly happen). The only write is the confirm-gated propose_internal_task,
 *  which surfaces as `approval_required`. Any "allow" from a non-read capability is
 *  an unexpected policy/result combination and fails closed. */
const READ_CAPABILITIES: ReadonlySet<string> = new Set(["portal.read_task_counts"]);

/** Returns a safe reason string if the raw args carry any key outside the exact
 *  permitted envelope for this capability, else null. Fail-closed. */
function argEnvelopeError(capabilityId: string, args: Record<string, unknown>): string | null {
  const allowed = ALLOWED_ARG_KEYS[capabilityId];
  if (!allowed) return "no_arg_contract"; // allowlisted but no declared envelope ⇒ refuse
  if (args === null || typeof args !== "object" || Array.isArray(args)) return "args_not_object";
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) return `unexpected_arg_key:${key}`;
  }
  return null;
}

export type ActionBridgeResult =
  | { status: "not_requested" }
  | { status: "rejected_by_bridge"; reason: string }
  | { status: "unauthorized"; reason: string }
  | { status: "read_result"; capabilityId: string; result: unknown }
  | { status: "monitor_only"; capabilityId: string; result: unknown }
  | { status: "approval_required"; capabilityId: string; proposalId: string }
  | { status: "failed"; capabilityId: string; reason: string };

export interface ActionBridgeDeps {
  /** Defaults to the real F1 entry point. */
  invoke?: (
    ctx: JarvisContext,
    capabilityId: string,
    rawArgs: unknown,
    opts?: { rationale?: string; targetClientId?: string | null; idempotencyKey?: string }
  ) => Promise<InvokeResult>;
  /** Defaults to the canonical registry lookup. */
  getCap?: (id: string) => JarvisCapability | null;
}

export interface ActionBridgeInput {
  /** The freshly reauthorized, consistency-checked context (from the orchestrator). */
  ctx: JarvisContext;
  intent: ValidatedProposedIntent | undefined;
  plan: ContextPlan;
  /** Trusted, server-generated F1c operation key (`turn:<turnId>:action:0`). Absent on
   *  the legacy keyless path. NEVER model/browser/user supplied. */
  operationKey?: string;
}

export async function bridgeProposedIntent(input: ActionBridgeInput, deps: ActionBridgeDeps = {}): Promise<ActionBridgeResult> {
  const { ctx, intent, plan, operationKey } = input;
  if (!intent) return { status: "not_requested" };

  const getCap = deps.getCap ?? getCapability;
  const invoke = deps.invoke ?? invokeCapability;

  // 1. Intelligence allowlist — the model may not reach arbitrary registry caps.
  if (!INTELLIGENCE_ACTION_ALLOWLIST.has(intent.capabilityId)) {
    return { status: "rejected_by_bridge", reason: "not_allowlisted" };
  }
  // 2. Must be canonically registered (defense in depth; allowlist ⊆ registry).
  if (!getCap(intent.capabilityId)) {
    return { status: "rejected_by_bridge", reason: "unregistered_capability" };
  }

  // 3. FAIL-CLOSED arg envelope: reject unexpected top-level keys BEFORE F1, so a
  //    model cannot have extra operational args silently stripped by the parser.
  const envErr = argEnvelopeError(intent.capabilityId, intent.args);
  if (envErr) return { status: "rejected_by_bridge", reason: envErr };

  // 4. Delegate to the EXISTING trusted F1 boundary. It re-validates args against
  //    the canonical parser, re-runs policy (grant/scope), audits, and routes.
  //    A model-supplied capability_id/args cannot bypass any of that.
  let res: InvokeResult;
  try {
    res = await invoke(ctx, intent.capabilityId, intent.args, {
      rationale: intent.rationale,
      targetClientId: plan.kind === "client" ? plan.clientId : null,
      // Trusted operation key for idempotent proposal creation (F1c). F1 applies it
      // only after its own re-validation/policy/audit; it is never authorization.
      idempotencyKey: operationKey,
    });
  } catch {
    return { status: "failed", capabilityId: intent.capabilityId, reason: "bridge_invocation_failed" };
  }

  switch (res.status) {
    case "allow":
      // Only the approved READ capability may legitimately reach "allow" (auto
      // read). No allowlisted capability is an auto-executed write, so an "allow"
      // from anything else is an unexpected policy/result combination → fail closed.
      return READ_CAPABILITIES.has(intent.capabilityId)
        ? { status: "read_result", capabilityId: intent.capabilityId, result: res.result }
        : { status: "failed", capabilityId: intent.capabilityId, reason: "unexpected_allow" };
    case "monitor_only":
      return { status: "monitor_only", capabilityId: intent.capabilityId, result: res.result };
    case "needs_approval":
      return { status: "approval_required", capabilityId: intent.capabilityId, proposalId: res.proposalId };
    case "deny":
      return { status: "unauthorized", reason: res.reason };
    case "error":
      // Fail closed. `reason` is a trusted bounded literal from F1 (e.g.
      // "execution_failed", or the F1c internal "idempotency_conflict"/"idempotency_state").
      // No public status is widened and no internal/DB detail is exposed.
      return { status: "failed", capabilityId: intent.capabilityId, reason: res.reason || "execution_failed" };
    default:
      return { status: "failed", capabilityId: intent.capabilityId, reason: "unknown_result" };
  }
}
