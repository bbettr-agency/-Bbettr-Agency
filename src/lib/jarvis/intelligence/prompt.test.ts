import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";
import type { ContextPackage } from "@/lib/jarvis/memory/context-shape";

/** Minimal, valid agency context package (no facts/memory needed for these assertions). */
function agencyContext(): ContextPackage {
  return {
    kind: "agency",
    subjectId: null,
    generatedAt: "2026-09-29T00:00:00.000Z",
    portal: { authoritative: true, sections: [] },
    memory: [],
    openCommitments: [],
    unresolvedConflicts: [],
    caps: { memory: 20, commitments: 15, conflicts: 15 },
    truncated: {},
  };
}

describe("buildSystemPrompt — model-facing action catalog is included", () => {
  const prompt = buildSystemPrompt([agencyContext()]);

  it("exposes the portal.propose_internal_task capability id", () => {
    expect(prompt).toContain('capability_id "portal.propose_internal_task"');
  });

  it("states the exact title-only contract and the 200-char limit", () => {
    expect(prompt).toContain("{ title: string }");
    expect(prompt.toLowerCase()).toContain("200 characters");
    expect(prompt.toLowerCase()).toContain("no other fields");
  });

  it("states that proposed_intent is a proposal, not execution", () => {
    expect(prompt).toContain("PROPOSAL ONLY");
    expect(prompt).toContain("does NOT execute");
  });

  it("tells the model not to conversationally pre-confirm an already-specified action", () => {
    expect(prompt).toContain("DIRECTLY");
    expect(prompt).toContain("do NOT ask for conversational confirmation");
  });

  it("keeps the catalog ABOVE and OUTSIDE the untrusted CONTEXT data block", () => {
    const catalogAt = prompt.indexOf("AVAILABLE ACTIONS");
    const contextAt = prompt.indexOf("===== BEGIN CONTEXT");
    expect(catalogAt).toBeGreaterThan(-1);
    expect(contextAt).toBeGreaterThan(catalogAt);
  });

  it("does not advertise non-allowlisted capabilities to the model", () => {
    expect(prompt).not.toContain("jarvis.ping");
  });
});
