import { describe, it, expect } from "vitest";
import { shapeMemoryContext, buildContextPackage, type MemorySummary } from "./context-shape";

function mem(p: Partial<MemorySummary>): MemorySummary {
  return {
    id: p.id ?? "m",
    scope: p.scope ?? "client",
    clientId: p.clientId ?? "c1",
    userId: p.userId ?? null,
    category: p.category ?? "context_note",
    claim: p.claim ?? "claim",
    importance: p.importance ?? 0,
    state: p.state ?? "confirmed",
    current: p.current ?? true,
    sourceKind: p.sourceKind ?? "human_statement",
    sourceRef: p.sourceRef ?? null,
    observedAt: p.observedAt ?? "2026-01-01T00:00:00Z",
    suppliedDisplay: p.suppliedDisplay ?? "Eloff",
    confirmedAt: p.confirmedAt ?? null,
    conflictsWithId: p.conflictsWithId ?? null,
    supersedesId: p.supersedesId ?? null,
    supersededById: p.supersededById ?? null,
  };
}

describe("context shaping — separation + currency", () => {
  it("excludes non-current (superseded/retired/proposed) rows", () => {
    const rows = [
      mem({ id: "a", state: "confirmed", current: true }),
      mem({ id: "b", state: "superseded", current: false }),
      mem({ id: "c", state: "proposed", current: false }),
    ];
    const s = shapeMemoryContext(rows);
    const ids = s.memory.map((m) => m.id);
    expect(ids).toEqual(["a"]);
  });

  it("separates commitments and conflicts from general memory", () => {
    const rows = [
      mem({ id: "gen", category: "context_note" }),
      mem({ id: "com", category: "commitment" }),
      mem({ id: "conf", category: "client_knowledge", conflictsWithId: "x" }),
    ];
    const s = shapeMemoryContext(rows);
    expect(s.memory.map((m) => m.id)).toEqual(["gen"]);
    expect(s.openCommitments.map((m) => m.id)).toEqual(["com"]);
    expect(s.unresolvedConflicts.map((m) => m.id)).toEqual(["conf"]);
  });

  it("orders by importance then recency and applies caps + truncation flags", () => {
    const rows = [
      mem({ id: "low", importance: 0, observedAt: "2026-01-01T00:00:00Z" }),
      mem({ id: "high", importance: 3, observedAt: "2026-01-01T00:00:00Z" }),
      mem({ id: "recent", importance: 0, observedAt: "2026-06-01T00:00:00Z" }),
    ];
    const s = shapeMemoryContext(rows, { memory: 2, commitments: 5, conflicts: 5 });
    expect(s.memory.map((m) => m.id)).toEqual(["high", "recent"]);
    expect(s.truncated.memory).toBe(true);
  });

  it("carries provenance on every item", () => {
    const s = shapeMemoryContext([mem({ id: "a", sourceKind: "human_statement", suppliedDisplay: "Ashwin" })]);
    expect(s.memory[0]?.provenance).toMatchObject({ sourceKind: "human_statement", suppliedDisplay: "Ashwin", state: "confirmed" });
  });
});

describe("buildContextPackage — authoritative Portal vs memory", () => {
  it("marks portal authoritative and keeps sections; separates memory", () => {
    const pkg = buildContextPackage({
      kind: "client",
      subjectId: "c1",
      generatedAt: "2026-09-01T00:00:00Z",
      portalSections: [{ title: "Client", facts: [{ key: "status", label: "Status", value: "active", source: "clients.status" }] }],
      memories: [mem({ id: "com", category: "commitment" }), mem({ id: "gen" })],
    });
    expect(pkg.portal.authoritative).toBe(true);
    expect(pkg.portal.sections[0]?.facts[0]?.source).toBe("clients.status");
    expect(pkg.openCommitments.map((m) => m.id)).toEqual(["com"]);
    expect(pkg.memory.map((m) => m.id)).toEqual(["gen"]);
    expect(pkg.kind).toBe("client");
  });
});
