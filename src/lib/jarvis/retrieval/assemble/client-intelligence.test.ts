import { describe, it, expect } from "vitest";
import { assembleClientEvidence } from "./client-intelligence";
import { planQuery } from "../plan/query-planner";
import { PORTAL_OPERATIONAL_DOMAINS } from "../types";
import type {
  DomainKey,
  EntityRef,
  EntityResolution,
  EvidenceFact,
  RetrieverContext,
  RetrieverDescriptor,
  RetrieverResult,
  RetrieverStatus,
  AuthorityClass,
} from "../types";

const ENTITY: EntityRef = { kind: "client", id: "a1", name: "A&S Wholesalers" };
const NOW = new Date("2026-09-30T00:00:00Z");
const rc = { ctx: {}, supabase: {}, now: () => NOW } as unknown as RetrieverContext;

const ff = (domain: DomainKey, authority: AuthorityClass, label: string, value: unknown): EvidenceFact => ({
  domain,
  authority,
  entity: ENTITY,
  label,
  value,
  source: "t",
});
const res = (domain: DomainKey, authority: AuthorityClass, status: RetrieverStatus, facts: EvidenceFact[], available: number): RetrieverResult => ({
  domain,
  authority,
  status,
  facts,
  returnedCount: facts.length,
  availableCount: available,
  truncated: available > facts.length,
  freshestAt: null,
  tookMs: 1,
});

function fakeDescriptor(domain: DomainKey, kind: "ok" | "empty" | "error"): RetrieverDescriptor {
  const authority: AuthorityClass = domain === "memory" ? "memory" : "portal_operational";
  const summary = () =>
    kind === "empty"
      ? res(domain, authority, "empty", [], 0)
      : kind === "error"
        ? res(domain, authority, "error", [], 0)
        : res(domain, authority, "ok", [ff(domain, authority, `${domain} summary`, "compact")], 1);
  const detail = () =>
    kind === "empty"
      ? res(domain, authority, "empty", [], 0)
      : kind === "error"
        ? res(domain, authority, "error", [], 0)
        : res(
            domain,
            authority,
            "ok",
            Array.from({ length: 20 }, (_, i) => ff(domain, authority, `${domain} detail ${i}`, "z".repeat(250))),
            30
          );
  return { domain, authority, authorization: "rls_principal", runSummary: async () => summary(), runDetail: async () => detail() };
}

function fakeRegistry(): Map<DomainKey, RetrieverDescriptor> {
  const m = new Map<DomainKey, RetrieverDescriptor>();
  for (const d of PORTAL_OPERATIONAL_DOMAINS) m.set(d, fakeDescriptor(d, d === "reports" ? "empty" : d === "contracts" ? "error" : "ok"));
  m.set("memory", fakeDescriptor("memory", "ok"));
  return m;
}

const resolvedOne: EntityResolution = {
  status: "one",
  kind: "client",
  entity: { kind: "client", id: "a1", canonicalName: "A&S Wholesalers", matchedOn: "name", tier: "exact", confidence: 1 },
};

describe("assembleClientEvidence — broad overview", () => {
  it("represents ALL 15 Portal operational domains + Memory separately", async () => {
    const plan = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: resolvedOne });
    const pkg = await assembleClientEvidence(plan, rc, fakeRegistry());
    const portal = new Set(pkg.portalAuthoritative.map((d) => d.domain));
    for (const d of PORTAL_OPERATIONAL_DOMAINS) expect(portal.has(d)).toBe(true);
    expect(pkg.portalAuthoritative).toHaveLength(15);
    expect(pkg.memory).toHaveLength(1);
    expect(pkg.memory[0].domain).toBe("memory");
    expect(pkg.memory[0].authority).toBe("memory");
  });

  it("keeps empty and failed domains represented (no silent disappearance)", async () => {
    const plan = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: resolvedOne });
    const pkg = await assembleClientEvidence(plan, rc, fakeRegistry());
    expect(pkg.domainStatus.reports).toBe("empty");
    expect(pkg.domainStatus.contracts).toBe("error");
    // still present in the evidence set
    expect(pkg.portalAuthoritative.some((d) => d.domain === "reports")).toBe(true);
    expect(pkg.portalAuthoritative.some((d) => d.domain === "contracts")).toBe(true);
  });

  it("trims Pass-B DETAIL under budget but never drops a Pass-A summary domain", async () => {
    const plan = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: resolvedOne });
    const pkg = await assembleClientEvidence(plan, rc, fakeRegistry());
    // Large detail forces some lower-priority domains to remain summary-only.
    expect(pkg.budget.droppedDomains.length).toBeGreaterThan(0);
    // But every one of the 15 domains is still present (as summary or detail).
    expect(pkg.portalAuthoritative).toHaveLength(15);
    // Higher-priority domains kept detail; a dropped one stays as summary phase.
    const dropped = pkg.budget.droppedDomains[0];
    const de = pkg.portalAuthoritative.find((d) => d.domain === dropped)!;
    expect(de.phase).toBe("summary");
  });

  it("is deterministic (same plan + registry → identical package)", async () => {
    const plan = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: resolvedOne });
    const a = await assembleClientEvidence(plan, rc, fakeRegistry());
    const b = await assembleClientEvidence(plan, rc, fakeRegistry());
    expect(a.portalAuthoritative.map((d) => d.domain)).toEqual(b.portalAuthoritative.map((d) => d.domain));
    expect(a.budget.droppedDomains).toEqual(b.budget.droppedDomains);
  });
});
