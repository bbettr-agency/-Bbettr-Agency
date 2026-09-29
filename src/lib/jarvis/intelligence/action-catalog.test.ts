import { describe, it, expect } from "vitest";
import { buildActionCatalog, allowedArgKeysFor, MODEL_FACING_ACTIONS } from "./action-catalog";
import { INTELLIGENCE_ACTION_ALLOWLIST, ALLOWED_ARG_KEYS } from "./action-allowlist";

describe("action-catalog — no-drift parity with the enforcement layer", () => {
  it("every model-facing capability is Intelligence-allowlisted (never exposes a non-allowlisted cap)", () => {
    for (const id of MODEL_FACING_ACTIONS) {
      expect(INTELLIGENCE_ACTION_ALLOWLIST.has(id)).toBe(true);
    }
  });

  it("the model-facing id set is exactly the locked V1 surface (drift tripwire)", () => {
    expect([...MODEL_FACING_ACTIONS]).toEqual(["portal.propose_internal_task"]);
  });

  it("each model-facing action's declared arg keys equal the trusted fail-closed envelope", () => {
    for (const id of MODEL_FACING_ACTIONS) {
      const envelope = [...(ALLOWED_ARG_KEYS[id] ?? new Set<string>())].sort();
      expect(allowedArgKeysFor(id)).toEqual(envelope);
    }
  });

  it("portal.propose_internal_task remains TITLE-ONLY (fails if the envelope ever widens)", () => {
    expect(allowedArgKeysFor("portal.propose_internal_task")).toEqual(["title"]);
    expect([...ALLOWED_ARG_KEYS["portal.propose_internal_task"]]).toEqual(["title"]);
  });
});

describe("action-catalog — rendered prompt text", () => {
  const text = buildActionCatalog();

  it("exposes the exact capability id and its title-only { title } schema", () => {
    expect(text).toContain('capability_id "portal.propose_internal_task"');
    expect(text).toContain("{ title: string }");
    expect(text.toLowerCase()).toContain("200 characters");
    expect(text.toLowerCase()).toContain("no other fields");
  });

  it("states that proposed_intent is a PROPOSAL, not execution", () => {
    expect(text).toContain("PROPOSAL ONLY");
    expect(text).toContain("does NOT execute");
    expect(text.toLowerCase()).toContain("approv"); // human approves afterward
  });

  it("tells the model to emit proposed_intent directly and NOT to conversationally pre-confirm", () => {
    expect(text).toContain("DIRECTLY");
    expect(text).toContain("do NOT ask for conversational confirmation");
    expect(text.toLowerCase()).toContain("clarifying question only when");
  });

  it("does NOT advertise non-Intelligence-allowlisted capabilities to the model", () => {
    expect(text).not.toContain("jarvis.ping");
    // The read capabilities exist in the enforcement allowlist but are not surfaced
    // as things to propose conversationally in V1.
    expect(text).not.toContain("portal.read_task_counts");
    expect(text).not.toContain("integrations.read_deployment_state");
  });
});
