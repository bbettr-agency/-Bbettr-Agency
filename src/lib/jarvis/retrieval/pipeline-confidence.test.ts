import { describe, it, expect } from "vitest";
import { discoveryConfidence, agencyConfidence } from "./pipeline";

/**
 * Deterministic confidence derivation for the non-client V2 paths (discovery, agency
 * fallback). These are pure — no DB, no model — proving confidence is APP-OWNED and
 * cannot be reinterpreted downstream. Client-path confidence is the assembler's
 * answerConfidence (covered in assemble/client-intelligence.test.ts).
 */

describe("discoveryConfidence", () => {
  it("a complete directory (ok) ⇒ HIGH; truncation is coverage, not lower confidence", () => {
    const c = discoveryConfidence("ok");
    expect(c.confidence).toBe("high");
    expect(c.confidenceBasis).toMatch(/coverage, not lower confidence/i);
  });
  it("a legitimately empty directory ⇒ HIGH (absence is a confident answer)", () => {
    expect(discoveryConfidence("empty").confidence).toBe("high");
  });
  it("a genuine retrieval FAILURE ⇒ QUALIFIED (cannot assert complete/empty)", () => {
    const c = discoveryConfidence("error");
    expect(c.confidence).toBe("qualified");
    expect(c.confidenceBasis).toMatch(/could NOT be retrieved/i);
  });
  it("never returns a 'low'-style degrade — only high | qualified", () => {
    for (const s of ["ok", "empty", "error"] as const) {
      expect(["high", "qualified"]).toContain(discoveryConfidence(s).confidence);
    }
  });
});

describe("agencyConfidence", () => {
  it("plain agency answer from retrieved data ⇒ HIGH", () => {
    expect(agencyConfidence(null).confidence).toBe("high");
  });
  it("an unsupported (not-yet-enabled) intent ⇒ QUALIFIED, naming the capability", () => {
    const c = agencyConfidence("client_financials");
    expect(c.confidence).toBe("qualified");
    expect(c.confidenceBasis).toContain("client_financials");
  });
});
