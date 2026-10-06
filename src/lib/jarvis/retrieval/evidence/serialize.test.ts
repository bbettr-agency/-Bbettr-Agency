import { describe, it, expect } from "vitest";
import { serializeEvidencePackage, serializeDomainEvidence, estimateTokens } from "./serialize";
import { summarizeUnpaid } from "../financial";
import type { DomainEvidence, EvidencePackage, EntityRef, EvidenceFact } from "../types";

const ENTITY: EntityRef = { kind: "client", id: "a1", name: "A&S Wholesalers" };
const NOW = new Date("2026-09-30T00:00:00Z");

const de = (over: Partial<DomainEvidence>): DomainEvidence => ({
  domain: "invoices",
  authority: "portal_operational",
  status: "ok",
  phase: "detail",
  facts: [],
  returnedCount: 0,
  availableCount: 0,
  truncated: false,
  freshestAt: null,
  ...over,
});
const f = (label: string, value: unknown, over: Partial<EvidenceFact> = {}): EvidenceFact => ({
  domain: "invoices",
  authority: "portal_operational",
  entity: ENTITY,
  label,
  value,
  source: "test",
  ...over,
});

describe("serialize — financial exact vs partial", () => {
  it("exact aggregate renders as an exact total", () => {
    const value = summarizeUnpaid([{ amount: 30000, currency: "ZAR" }], 1);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).toContain("exact total");
    expect(out).not.toContain("lower bound");
  });
  it("truncated aggregate renders as PARTIAL lower bound, never an exact total", () => {
    const value = summarizeUnpaid([{ amount: 30000, currency: "ZAR" }], 8);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).toMatch(/PARTIAL|lower bound/);
    expect(out).toContain("NOT the exact total");
    expect(out).not.toContain("exact total)"); // must not present as the exact total
  });
});

describe("serialize — failure states are distinguishable", () => {
  const render = (status: DomainEvidence["status"]) => serializeDomainEvidence(de({ domain: "reports", status }), NOW);
  it("empty / error / denied / unavailable each render distinctly", () => {
    expect(render("empty")).toContain("none on file");
    expect(render("error")).toContain("could not be retrieved");
    expect(render("denied")).toContain("not accessible");
    expect(render("unavailable")).toContain("integration not available");
  });
  it("truncated renders 'showing N of M'", () => {
    const out = serializeDomainEvidence(de({ domain: "tasks", status: "truncated", facts: [f("t", "open")], returnedCount: 10, availableCount: 24, truncated: true }), NOW);
    expect(out).toContain("showing 10 of 24");
  });
});

describe("serialize — security", () => {
  it("secret-scans every rendered value (top-level and nested)", () => {
    const secret = "sk-A1b2C3d4E5f6G7h8I9j0K1l2";
    const out = serializeDomainEvidence(
      de({ facts: [f("Note", `use ${secret} now`), f("Obj", { key: secret, ok: "plain" })] }),
      NOW
    );
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED_SECRET]");
    expect(out).toContain("plain");
  });
  it("never renders internal recordRef / DB ids", () => {
    const out = serializeDomainEvidence(de({ facts: [f("X", "y", { recordRef: "client_invoices:SECRET-ROW-ID" })] }), NOW);
    expect(out).not.toContain("SECRET-ROW-ID");
    expect(out).not.toContain("recordRef");
  });
});

describe("serialize — package separation", () => {
  it("keeps Portal authoritative separate from supplementary Memory", () => {
    const pkg: EvidencePackage = {
      generatedAt: NOW.toISOString(),
      intent: "client_detail",
      mode: "broad",
      subject: ENTITY,
      answerConfidence: "high",
      confidenceBasis: "test",
      portalAuthoritative: [de({ domain: "client_identity", status: "ok", facts: [f("Status", "active")] })],
      memory: [de({ domain: "memory", authority: "memory", status: "ok", facts: [f("m", "a decision")] })],
      domainStatus: {},
      budget: { totalBudgetTokens: 10000, estimatedTokens: 10, droppedDomains: [], clippedDomains: [] },
    };
    const out = serializeEvidencePackage(pkg, NOW);
    expect(out).toContain("AUTHORITATIVE PORTAL FACTS");
    expect(out).toContain("DURABLE MEMORY (supplementary");
    expect(out.indexOf("AUTHORITATIVE")).toBeLessThan(out.indexOf("DURABLE MEMORY"));
  });
});

describe("serialize — currency safety (never invented)", () => {
  it("renders a known currency as a CODE, never a symbol", () => {
    const value = summarizeUnpaid([{ amount: 1999.99, currency: "ZAR" }], 1);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).toContain("ZAR 1999.99");
    expect(out).not.toContain("$");
    expect(out).not.toContain("R1999");
  });
  it("never emits '$' or an assumed code when currency is unknown", () => {
    // currency null (no rows summed but a count exists) ⇒ bare number, no symbol/code.
    const value = summarizeUnpaid([], 3);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).not.toContain("$");
    expect(out).not.toContain("ZAR");
  });
  it("does not collapse mixed currencies into one total", () => {
    const value = summarizeUnpaid([{ amount: 100, currency: "ZAR" }, { amount: 50, currency: "USD" }], 2);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).toContain("MULTIPLE currencies");
    expect(out).toContain("do not combine");
    expect(out).not.toContain("exact total");
  });
  it("zero unpaid renders no amount and no '$0'", () => {
    const value = summarizeUnpaid([], 0);
    const out = serializeDomainEvidence(de({ facts: [f("Outstanding", value)] }), NOW);
    expect(out).toContain("nothing currently outstanding");
    expect(out).not.toContain("$0");
    expect(out).not.toContain("$");
  });
});

describe("serialize — coverage is NOT lowered confidence", () => {
  it("a bounded list is disclosed as coverage, explicitly not confidence", () => {
    const out = serializeDomainEvidence(
      de({ domain: "activity", status: "truncated", facts: [f("e", "x")], returnedCount: 8, availableCount: 21, truncated: true }),
      NOW
    );
    // Per-domain unit noun, and the explicit coverage-not-confidence disclaimer.
    expect(out).toContain("showing 8 of 21 events");
    expect(out).toContain("this is coverage, not lower confidence");
  });
  it("each domain carries its OWN unit and counts — never mixed", () => {
    const activity = serializeDomainEvidence(
      de({ domain: "activity", status: "truncated", facts: [f("e", "x")], returnedCount: 8, availableCount: 21, truncated: true }),
      NOW
    );
    const files = serializeDomainEvidence(
      de({ domain: "files", status: "truncated", facts: [f("fl", "x")], returnedCount: 10, availableCount: 12, truncated: true }),
      NOW
    );
    expect(activity).toContain("8 of 21 events");
    expect(activity).not.toContain("files");
    expect(files).toContain("10 of 12 files");
    expect(files).not.toContain("events");
  });
});

describe("serialize — deterministic ANSWER QUALITY block", () => {
  const pkg = (answerConfidence: "high" | "qualified", confidenceBasis: string): EvidencePackage => ({
    generatedAt: NOW.toISOString(),
    intent: "client_detail",
    mode: "broad",
    subject: ENTITY,
    answerConfidence,
    confidenceBasis,
    portalAuthoritative: [de({ domain: "client_identity", status: "ok", facts: [f("Status", "active")] })],
    memory: [],
    domainStatus: {},
    budget: { totalBudgetTokens: 10000, estimatedTokens: 10, droppedDomains: [], clippedDomains: [] },
  });
  it("renders HIGH when the package is high-confidence", () => {
    const out = serializeEvidencePackage(pkg("high", "all authoritative"), NOW);
    expect(out).toContain("ANSWER QUALITY");
    expect(out).toContain("Overall confidence: HIGH");
    expect(out).toContain("all authoritative");
  });
  it("renders QUALIFIED only when a depended-on domain could not be retrieved", () => {
    const out = serializeEvidencePackage(pkg("qualified", "invoices could NOT be retrieved"), NOW);
    expect(out).toContain("Overall confidence: QUALIFIED");
  });
});

describe("estimateTokens", () => {
  it("~ chars/4", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
