import { describe, it, expect } from "vitest";
import { decideIngestion, type IngestionInput } from "./ingestion";

const base: IngestionInput = {
  category: "context_note",
  sourceKind: "human_statement",
  claim: "Client prefers concise weekly updates",
  supplierHasApproveAuthority: true,
};

describe("ingestion policy", () => {
  it("rejects prohibited secrets (never persists content)", () => {
    const r = decideIngestion({ ...base, claim: "api_key = ABCD1234EFGH5678" });
    expect(r.decision).toBe("reject");
    if (r.decision === "reject") {
      expect(r.reason).toBe("prohibited_secret");
      expect(JSON.stringify(r)).not.toContain("ABCD1234EFGH5678");
    }
  });

  it("rejects a candidate that duplicates Portal-owned operational truth", () => {
    const r = decideIngestion({ ...base, assertsPortalOwnedValue: true });
    expect(r).toMatchObject({ decision: "reject", reason: "duplicates_portal_truth" });
  });

  it("model_inference is stored as 'inferred' — never auto-truth", () => {
    const r = decideIngestion({ ...base, sourceKind: "model_inference" });
    expect(r).toMatchObject({ decision: "store", state: "inferred" });
  });

  it("auto-accepts objective founder statement in a safe category as 'observed'", () => {
    expect(decideIngestion(base)).toMatchObject({ decision: "store", state: "observed" });
    expect(decideIngestion({ ...base, category: "preference_rule" })).toMatchObject({ state: "observed" });
    expect(decideIngestion({ ...base, category: "company_knowledge" })).toMatchObject({ state: "observed" });
    expect(decideIngestion({ ...base, category: "client_knowledge" })).toMatchObject({ state: "observed" });
  });

  it("decisions and commitments always require confirmation (proposed)", () => {
    expect(decideIngestion({ ...base, category: "decision" })).toMatchObject({ state: "proposed" });
    expect(decideIngestion({ ...base, category: "commitment" })).toMatchObject({ state: "proposed" });
  });

  it("a non-authorised supplier cannot auto-accept — content becomes proposed", () => {
    expect(decideIngestion({ ...base, supplierHasApproveAuthority: false })).toMatchObject({ state: "proposed" });
  });

  it("non-objective source (document) is not auto-accepted", () => {
    expect(decideIngestion({ ...base, sourceKind: "document" })).toMatchObject({ state: "proposed" });
  });
});
