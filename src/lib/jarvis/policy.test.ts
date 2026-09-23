import { describe, it, expect } from "vitest";
import { decide, type PolicyInput, type PolicyCapabilityView } from "./policy";

const cap = (over: Partial<PolicyCapabilityView> = {}): PolicyCapabilityView => ({
  id: "c",
  riskClass: "auto",
  requiredGrant: "g",
  scope: "agency",
  enabled: true,
  ...over,
});

const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  authenticated: true,
  workspaceResolved: true,
  principalId: "p1",
  grantedKeys: new Set(["g"]),
  capability: cap(),
  argsValid: true,
  scopeResolved: true,
  ...over,
});

describe("policy.decide — fail-closed authorization kernel", () => {
  it("unauthenticated → deny", () => {
    expect(decide(base({ authenticated: false })).outcome).toBe("deny");
  });
  it("workspace unresolved → deny", () => {
    expect(decide(base({ workspaceResolved: false })).outcome).toBe("deny");
    expect(decide(base({ principalId: null })).outcome).toBe("deny");
  });
  it("unregistered capability → deny", () => {
    expect(decide(base({ capability: null })).reason).toBe("unregistered_capability");
  });
  it("disabled capability → deny", () => {
    expect(decide(base({ capability: cap({ enabled: false }) })).reason).toBe("capability_disabled");
  });
  it("missing grant → deny (default-deny)", () => {
    expect(decide(base({ grantedKeys: new Set() })).reason).toBe("missing_grant");
  });
  it("invalid arguments → deny", () => {
    expect(decide(base({ argsValid: false })).reason).toBe("invalid_arguments");
  });
  it("client scope unresolved/ambiguous → deny", () => {
    expect(decide(base({ capability: cap({ scope: "client" }), scopeResolved: false })).reason).toBe(
      "ambiguous_or_unauthorized_scope"
    );
  });

  it("auto + granted → allow", () => {
    expect(decide(base()).outcome).toBe("allow");
  });
  it("monitor → monitor_only (never mutate)", () => {
    expect(decide(base({ capability: cap({ riskClass: "monitor" }) })).outcome).toBe("monitor_only");
  });

  describe("confirm/destructive require valid, authorised approval", () => {
    const confirmCap = cap({ riskClass: "confirm" });
    const destructiveCap = cap({ riskClass: "destructive" });

    it("no approval → needs_approval (never auto-executes)", () => {
      expect(decide(base({ capability: confirmCap })).outcome).toBe("needs_approval");
      expect(decide(base({ capability: destructiveCap })).outcome).toBe("needs_approval");
    });
    it("stale/mismatched approval → deny", () => {
      const d = decide(base({ capability: confirmCap, approval: { present: true, valid: false, approverHasGrant: true } }));
      expect(d.outcome).toBe("deny");
      expect(d.reason).toBe("stale_or_mismatched_approval");
    });
    it("approver lacks approval grant → deny", () => {
      const d = decide(base({ capability: confirmCap, approval: { present: true, valid: true, approverHasGrant: false } }));
      expect(d.outcome).toBe("deny");
      expect(d.reason).toBe("approver_lacks_grant");
    });
    it("present + valid + authorised → allow", () => {
      expect(
        decide(base({ capability: confirmCap, approval: { present: true, valid: true, approverHasGrant: true } })).outcome
      ).toBe("allow");
    });
    it("DESTRUCTIVE can only reach allow WITH a valid authorised approval, never auto", () => {
      // no approval context at all
      expect(decide(base({ capability: destructiveCap })).outcome).toBe("needs_approval");
      // even 'present but invalid' never allows a destructive action
      expect(
        decide(base({ capability: destructiveCap, approval: { present: true, valid: false, approverHasGrant: true } })).outcome
      ).toBe("deny");
      // only a fully valid, authorised approval allows it
      expect(
        decide(base({ capability: destructiveCap, approval: { present: true, valid: true, approverHasGrant: true } })).outcome
      ).toBe("allow");
    });
  });

  it("unknown risk class → deny (fail closed)", () => {
    expect(decide(base({ capability: cap({ riskClass: "weird" as never }) })).outcome).toBe("deny");
  });
});
