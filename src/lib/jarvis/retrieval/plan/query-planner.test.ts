import { describe, it, expect } from "vitest";
import { planQuery } from "./query-planner";
import { PORTAL_OPERATIONAL_DOMAINS } from "../types";
import type { EntityResolution, EntityCandidate } from "../types";

const cand = (id: string, name: string): EntityCandidate => ({
  kind: "client",
  id,
  canonicalName: name,
  matchedOn: "name",
  tier: "exact",
  confidence: 1,
});
const one = (id = "a1", name = "A&S Wholesalers"): EntityResolution => ({ status: "one", kind: "client", entity: cand(id, name) });
const many = (): EntityResolution => ({ status: "many", kind: "client", candidates: [cand("f1", "Fine Art Printers"), cand("f2", "Fine Art Studio")] });
const none = (query: string): EntityResolution => ({ status: "none", kind: "client", query });

describe("planQuery — broad client overview", () => {
  const plan = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: one() });
  it("is client_detail / broad on a resolved client with no focus", () => {
    expect(plan.intent).toBe("client_detail");
    expect(plan.mode).toBe("broad");
    expect(plan.subject?.id).toBe("a1");
  });
  it("Pass A covers ALL 15 Portal operational domains + Memory (16), separately", () => {
    const passA = new Set(plan.passA.map((i) => i.domain));
    for (const d of PORTAL_OPERATIONAL_DOMAINS) expect(passA.has(d)).toBe(true);
    expect(passA.has("memory")).toBe(true);
    expect(passA.size).toBe(16);
    expect(plan.passA.every((i) => i.phase === "summary")).toBe(true);
  });
  it("Pass B allocates detail for the Portal domains + memory, priority-ordered", () => {
    const passB = plan.passB.map((i) => i.domain);
    expect(passB).toContain("updates");
    expect(passB).toContain("tasks");
    expect(passB).toContain("memory");
    const pr = plan.passB.map((i) => i.priority);
    expect([...pr]).toEqual([...pr].sort((a, b) => a - b)); // ascending
  });
});

describe("planQuery — focused", () => {
  it("tasks focus deepens tasks and keeps a bounded supporting summary", () => {
    const plan = planQuery({ message: "What tasks are outstanding for A&S?", resolution: one() });
    expect(plan.intent).toBe("client_subdomain");
    expect(plan.mode).toBe("focused");
    expect(plan.focus).toContain("tasks");
    const detail = plan.passB.filter((i) => i.domain === "tasks");
    expect(detail).toHaveLength(1);
    // supporting mini-summary is a fixed small set (NOT all 16)
    expect(plan.passA.length).toBeLessThanOrEqual(6);
    expect(plan.passA.some((i) => i.domain === "client_identity")).toBe(true);
  });
  it("financial focus pulls on-demand billing_details into detail", () => {
    const plan = planQuery({ message: "What is the financial state of A&S?", resolution: one() });
    expect(plan.focus).toContain("financial");
    const d = plan.passB.map((i) => i.domain);
    expect(d).toEqual(expect.arrayContaining(["invoices", "payments", "retainers", "billing_details"]));
  });
});

describe("planQuery — memory decision", () => {
  it("prioritises Memory in detail while keeping Portal authoritative in Pass A", () => {
    const plan = planQuery({ message: "What have we decided about A&S?", resolution: one() });
    expect(plan.intent).toBe("memory_decision");
    expect(plan.passB[0].domain).toBe("memory"); // memory detail kept first
    expect(new Set(plan.passA.map((i) => i.domain)).size).toBe(16); // portal still represented
  });
});

describe("planQuery — discovery / clarify / unresolved / fallback / future", () => {
  it("discovery phrasing → client_discovery", () => {
    expect(planQuery({ message: "Who are all our clients?", resolution: none("all our clients") }).intent).toBe("client_discovery");
  });
  it("ambiguous resolution → clarify with candidates", () => {
    const plan = planQuery({ message: "what is happening with Fine Art", resolution: many() });
    expect(plan.intent).toBe("clarify");
    expect(plan.clarify?.candidates).toHaveLength(2);
  });
  it("named-but-unfound client → unresolved (not agency fallback)", () => {
    const plan = planQuery({ message: "What is happening with Globex Corporation?", resolution: none("Globex Corporation") });
    expect(plan.intent).toBe("unresolved");
  });
  it("generic question with no subject → agency_fallback", () => {
    const plan = planQuery({ message: "give me a quick status update", resolution: none("") });
    expect(plan.intent).toBe("agency_fallback");
  });
  it("FUTURE intents are recognised but marked unsupported", () => {
    expect(planQuery({ message: "compare Fine Art and Cuisine", resolution: many() }).supported).toBe(false);
    expect(planQuery({ message: "what is Ashwin working on?", resolution: none("Ashwin") }).supported).toBe(false);
    expect(planQuery({ message: "what changed this week?", resolution: none("") }).supported).toBe(false);
    expect(planQuery({ message: "what is happening across Bbettr today?", resolution: none("") }).supported).toBe(false);
  });
});

describe("planQuery — determinism", () => {
  it("same message + resolution → identical plan", () => {
    const a = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: one() });
    const b = planQuery({ message: "What is happening with A&S Wholesalers?", resolution: one() });
    expect(a).toEqual(b);
  });
});
