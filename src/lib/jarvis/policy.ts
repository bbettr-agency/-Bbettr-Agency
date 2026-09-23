/**
 * Jarvis deterministic POLICY ENGINE (Foundation 1). Pure — no I/O, no model.
 *
 * This is the security boundary. Given the authenticated principal, the resolved
 * workspace, the caller's effective grants, the (looked-up) capability, argument
 * validity, scope resolution and any approval context, it returns exactly one
 * of: allow | deny | needs_approval | monitor_only. It is deliberately the ONLY
 * place these decisions are made, and it FAILS CLOSED at every step.
 *
 * The LLM/content can never influence this: it operates purely on
 * application-verified inputs, never on model output or untrusted content.
 */
import type { PolicyOutcome, RiskClass, CapabilityScope } from "./types";

export interface PolicyCapabilityView {
  id: string;
  riskClass: RiskClass;
  requiredGrant: string;
  scope: CapabilityScope;
  enabled: boolean;
}

export interface PolicyApproval {
  present: boolean;
  /** hash-match AND fresh AND single-use (all computed by the app, not here). */
  valid: boolean;
  /** the approver holds the approval-authority grant (jarvis.approve). */
  approverHasGrant: boolean;
}

export interface PolicyInput {
  authenticated: boolean;
  workspaceResolved: boolean;
  principalId: string | null;
  /** Effective (bundle-expanded) grant keys the principal holds. */
  grantedKeys: ReadonlySet<string>;
  /** The registered capability, or null when the id is unregistered. */
  capability: PolicyCapabilityView | null;
  argsValid: boolean;
  /** For client-scoped capabilities: a concrete, authorised, unambiguous client. */
  scopeResolved: boolean;
  approval?: PolicyApproval;
}

export interface PolicyDecision {
  outcome: PolicyOutcome;
  reason: string;
  riskClass: RiskClass | null;
}

const deny = (reason: string, riskClass: RiskClass | null = null): PolicyDecision => ({
  outcome: "deny",
  reason,
  riskClass,
});

export function decide(input: PolicyInput): PolicyDecision {
  // 1. Identity + agency context must be resolved.
  if (!input.authenticated) return deny("unauthenticated");
  if (!input.workspaceResolved || !input.principalId) return deny("workspace_or_principal_unresolved");

  // 2. Capability must be registered and enabled.
  const cap = input.capability;
  if (!cap) return deny("unregistered_capability");
  if (!cap.enabled) return deny("capability_disabled", cap.riskClass);

  // 3. Principal must hold the required grant (default-deny).
  if (!input.grantedKeys.has(cap.requiredGrant)) return deny("missing_grant", cap.riskClass);

  // 4. Arguments must validate (never trust model/content-shaped input).
  if (!input.argsValid) return deny("invalid_arguments", cap.riskClass);

  // 5. Client-scoped actions need a concrete authorised, unambiguous client.
  if (cap.scope === "client" && !input.scopeResolved) {
    return deny("ambiguous_or_unauthorized_scope", cap.riskClass);
  }

  // 6. Route by risk class.
  switch (cap.riskClass) {
    case "monitor":
      // Read/recommend only; must never mutate.
      return { outcome: "monitor_only", reason: "monitor_only", riskClass: cap.riskClass };

    case "auto":
      return { outcome: "allow", reason: "auto_allowed", riskClass: cap.riskClass };

    case "confirm":
    case "destructive": {
      const a = input.approval;
      if (!a || !a.present) {
        return { outcome: "needs_approval", reason: "approval_required", riskClass: cap.riskClass };
      }
      // An approval is present — it must be valid (hash-match/fresh/single-use)
      // AND made by someone with approval authority. Anything else is REJECTED
      // (deny), never allowed — covers stale, mismatched, and unauthorised approvals.
      if (!a.valid) return deny("stale_or_mismatched_approval", cap.riskClass);
      if (!a.approverHasGrant) return deny("approver_lacks_grant", cap.riskClass);
      // A destructive action can ONLY reach 'allow' here — i.e. with an explicit,
      // valid, authorised approval. It can never be auto-executed.
      return { outcome: "allow", reason: "approved", riskClass: cap.riskClass };
    }

    default:
      // Unknown risk class ⇒ fail closed.
      return deny("unknown_risk_class");
  }
}
