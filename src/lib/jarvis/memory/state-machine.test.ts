import { describe, it, expect } from "vitest";
import { decideTransition, currentOnCreate } from "./state-machine";

const A = { hasApproveAuthority: true };
const NO = { hasApproveAuthority: false };

describe("memory state machine — creation currency", () => {
  it("observed is active truth on create; inferred/proposed are not", () => {
    expect(currentOnCreate("observed")).toBe(true);
    expect(currentOnCreate("inferred")).toBe(false);
    expect(currentOnCreate("proposed")).toBe(false);
  });
});

describe("memory state machine — legal transitions", () => {
  it("proposed → confirm (with authority) → confirmed, current", () => {
    expect(decideTransition({ from: "proposed", transition: "confirm", ...A })).toEqual({ ok: true, to: "confirmed", current: true });
  });
  it("inferred → confirm (with authority) → confirmed", () => {
    expect(decideTransition({ from: "inferred", transition: "confirm", ...A })).toEqual({ ok: true, to: "confirmed", current: true });
  });
  it("proposed → reject → rejected, not current", () => {
    expect(decideTransition({ from: "proposed", transition: "reject", ...A })).toEqual({ ok: true, to: "rejected", current: false });
  });
  it("observed/confirmed → supersede → superseded, not current", () => {
    expect(decideTransition({ from: "observed", transition: "supersede", ...A })).toEqual({ ok: true, to: "superseded", current: false });
    expect(decideTransition({ from: "confirmed", transition: "supersede", ...A })).toEqual({ ok: true, to: "superseded", current: false });
  });
  it("confirmed → retire → retired, not current", () => {
    expect(decideTransition({ from: "confirmed", transition: "retire", ...A })).toEqual({ ok: true, to: "retired", current: false });
  });
});

describe("memory state machine — critical invariants", () => {
  it("inferred can NEVER silently become confirmed (no authority ⇒ denied)", () => {
    const r = decideTransition({ from: "inferred", transition: "confirm", ...NO });
    expect(r).toEqual({ ok: false, reason: "requires_approval_authority" });
  });
  it("proposed → confirmed requires authority", () => {
    expect(decideTransition({ from: "proposed", transition: "confirm", ...NO }).ok).toBe(false);
  });
  it("supersede/retire/reject all require authority", () => {
    expect(decideTransition({ from: "observed", transition: "supersede", ...NO }).ok).toBe(false);
    expect(decideTransition({ from: "confirmed", transition: "retire", ...NO }).ok).toBe(false);
    expect(decideTransition({ from: "proposed", transition: "reject", ...NO }).ok).toBe(false);
  });
  it("terminal states cannot transition (rejected/superseded/retired)", () => {
    for (const from of ["rejected", "superseded", "retired"] as const) {
      expect(decideTransition({ from, transition: "confirm", ...A }).ok).toBe(false);
      expect(decideTransition({ from, transition: "supersede", ...A }).ok).toBe(false);
    }
  });
  it("rejected never becomes truth (no confirm path out)", () => {
    const r = decideTransition({ from: "rejected", transition: "confirm", ...A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("terminal");
  });
  it("illegal from-states are rejected (e.g. confirmed→confirm, confirmed→reject)", () => {
    expect(decideTransition({ from: "confirmed", transition: "confirm", ...A }).ok).toBe(false);
    expect(decideTransition({ from: "confirmed", transition: "reject", ...A }).ok).toBe(false);
    expect(decideTransition({ from: "proposed", transition: "supersede", ...A }).ok).toBe(false);
  });
});
