import { describe, it, expect } from "vitest";
import { deriveFocus, deriveAttention } from "./command-centre-state";

const stage = (
  name: string,
  status: "completed" | "in_progress" | "pending",
  position: number,
  target_date: string | null = null
) => ({ name, status, position, target_date });

describe("deriveFocus — current focus / next milestone from the roadmap", () => {
  it("returns hasStages=false and the estimated launch as ETA when there are no stages", () => {
    const f = deriveFocus([], "2026-09-01");
    expect(f.hasStages).toBe(false);
    expect(f.currentLabel).toBeNull();
    expect(f.nextLabel).toBeNull();
    expect(f.etaDate).toBe("2026-09-01");
  });

  it("picks the in-progress stage as current and the next not-complete stage as next", () => {
    const f = deriveFocus(
      [
        stage("Contract Signed", "completed", 0),
        stage("In Development", "in_progress", 2, "2026-08-30"),
        stage("Assets Received", "completed", 1),
        stage("Review Stage", "pending", 3),
        stage("Launch", "pending", 4),
      ],
      "2026-09-15"
    );
    expect(f.currentLabel).toBe("In Development");
    expect(f.nextLabel).toBe("Review Stage");
    // ETA prefers the current stage's target_date over the client launch date.
    expect(f.etaDate).toBe("2026-08-30");
  });

  it("falls back to the client estimated launch when the current stage has no target date", () => {
    const f = deriveFocus(
      [stage("In Development", "in_progress", 0)],
      "2026-09-15"
    );
    expect(f.etaDate).toBe("2026-09-15");
  });

  it("uses the first pending stage as current when nothing is in progress", () => {
    const f = deriveFocus(
      [
        stage("Contract Signed", "completed", 0),
        stage("Assets Received", "pending", 1),
        stage("Launch", "pending", 2),
      ],
      null
    );
    expect(f.currentLabel).toBe("Assets Received");
    expect(f.nextLabel).toBe("Launch");
  });

  it("reports allComplete with no current/next when every stage is done", () => {
    const f = deriveFocus(
      [stage("Launch", "completed", 1), stage("Contract Signed", "completed", 0)],
      null
    );
    expect(f.allComplete).toBe(true);
    expect(f.currentLabel).toBeNull();
    expect(f.nextLabel).toBeNull();
  });
});

describe("deriveAttention — existing-data-only signals, quiet when clear", () => {
  const clear = { overdueByCurrency: {}, overdueCount: 0, openQuestions: 0, readinessPending: 0 };

  it("returns an empty array when nothing needs attention", () => {
    expect(deriveAttention(clear)).toEqual([]);
  });

  it("surfaces an overdue billing amount (danger), formatted per currency", () => {
    const items = deriveAttention({
      ...clear,
      overdueByCurrency: { ZAR: 2000 },
      overdueCount: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("billing");
    expect(items[0].tone).toBe("danger");
    expect(items[0].label).toContain("Payment overdue");
    expect(items[0].label).toContain("2");
    expect(items[0].label).toContain("000");
  });

  it("surfaces open client questions (warning) with correct pluralisation", () => {
    expect(deriveAttention({ ...clear, openQuestions: 1 })[0].label).toBe(
      "1 open client question"
    );
    expect(deriveAttention({ ...clear, openQuestions: 3 })[0].label).toBe(
      "3 open client questions"
    );
  });

  it("surfaces outstanding client assets as waiting-on-client (warning)", () => {
    const items = deriveAttention({ ...clear, readinessPending: 2 });
    expect(items[0].kind).toBe("readiness");
    expect(items[0].tone).toBe("warning");
    expect(items[0].label).toBe("Waiting on client — 2 items outstanding");
  });

  it("orders items billing → questions → readiness when several are present", () => {
    const items = deriveAttention({
      overdueByCurrency: { ZAR: 500 },
      overdueCount: 1,
      openQuestions: 2,
      readinessPending: 1,
    });
    expect(items.map((i) => i.kind)).toEqual(["billing", "questions", "readiness"]);
  });

  it("falls back to an invoice count when an overdue amount is unavailable", () => {
    const items = deriveAttention({ ...clear, overdueCount: 2 });
    expect(items[0].label).toBe("2 invoices overdue");
  });
});
