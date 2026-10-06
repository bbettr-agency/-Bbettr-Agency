import { describe, it, expect } from "vitest";
import { buildTrace } from "./trace";
import type { EvidencePackage, EntityResolution, RetrievalPlan, EntityRef } from "../types";

const ENTITY: EntityRef = { kind: "client", id: "c1", name: "A&S Wholesalers" };
const SECRET_VALUE = "SECRET-sk-A1b2C3d4E5f6G7h8I9j0K1l2";

const plan: RetrievalPlan = {
  intent: "client_detail",
  mode: "broad",
  subject: ENTITY,
  focus: [],
  passA: [{ domain: "client_identity", phase: "summary", budgetTokens: 100, priority: 1 }],
  passB: [{ domain: "updates", phase: "detail", detailLimit: 5, budgetTokens: 700, priority: 4 }],
  supported: true,
};

const evidence: EvidencePackage = {
  generatedAt: "2026-10-06T00:00:00Z",
  intent: "client_detail",
  mode: "broad",
  subject: ENTITY,
  answerConfidence: "high",
  confidenceBasis: "test",
  portalAuthoritative: [
    {
      domain: "updates",
      authority: "portal_operational",
      status: "truncated",
      phase: "detail",
      // a fact carrying a secret + an internal recordRef — neither must reach the trace
      facts: [{ domain: "updates", authority: "portal_operational", entity: ENTITY, label: "Update", value: SECRET_VALUE, source: "updates", recordRef: "updates:ROW-SECRET-ID" }],
      returnedCount: 3,
      availableCount: 5,
      truncated: true,
      freshestAt: "2026-09-01T00:00:00Z",
    },
  ],
  memory: [
    { domain: "memory", authority: "memory", status: "ok", phase: "detail", facts: [{ domain: "memory", authority: "memory", entity: ENTITY, label: "m", value: SECRET_VALUE, source: "jarvis_memories" }], returnedCount: 2, availableCount: 2, truncated: false, freshestAt: null },
  ],
  domainStatus: { updates: "truncated", memory: "ok" },
  budget: { totalBudgetTokens: 10000, estimatedTokens: 1200, droppedDomains: ["files"], clippedDomains: [] },
};

const resolution: EntityResolution = { status: "one", kind: "client", entity: { kind: "client", id: "c1", canonicalName: "A&S Wholesalers", matchedOn: "name", tier: "exact", confidence: 1 } };

describe("buildTrace — safe observability", () => {
  const trace = buildTrace({
    requestId: "req-1",
    resolution,
    plan,
    evidence,
    history: { turnsIncluded: 2, estTokens: 100, reducedFromTarget: true },
    promptInputEstTokens: 3000,
    totalMs: 12,
  });
  const json = JSON.stringify(trace);

  it("carries structured counts/status/domains only", () => {
    expect(trace.intent).toBe("client_detail");
    expect(trace.resolution).toEqual({ status: "one", tier: "exact", resolvedClientId: "c1" });
    expect(trace.passB.domainsDetailed).toContain("updates");
    expect(trace.passB.domainsDetailOmitted).toContain("files");
    expect(trace.retrievers[0]).toMatchObject({ domain: "updates", status: "truncated", returned: 3, available: 5, truncated: true });
    expect(trace.history.reducedFromTarget).toBe(true);
  });

  it("contains NO free-text fact values", () => {
    expect(json).not.toContain(SECRET_VALUE);
  });

  it("contains NO internal recordRef / DB row ids", () => {
    expect(json).not.toContain("ROW-SECRET-ID");
    expect(json).not.toContain("recordRef");
  });

  it("the resolved CLIENT id is present (internal provenance, allowed)", () => {
    expect(trace.resolution.resolvedClientId).toBe("c1");
  });
});
