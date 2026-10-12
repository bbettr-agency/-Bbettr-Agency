import { describe, it, expect } from "vitest";
import {
  classifyQuestionBreadth,
  broadCoverageComplete,
  unexaminedAgencyAreas,
  SUPPORTED_AGENCY_KEYS,
  UNSUPPORTED_AGENCY_KEYS,
  type CoverageKey,
} from "./coverage";

describe("classifyQuestionBreadth", () => {
  it("classifies whole-business / cross-client / attention questions as BROAD", () => {
    for (const q of [
      "What needs my attention?",
      "What needs my attention across Bbettr?",
      "What's happening across the agency?",
      "Is everything okay with my business?",
      "Which clients need attention?",
      "How are things overall?",
      "state of the business please",
    ]) {
      expect(classifyQuestionBreadth(q)).toBe("broad");
    }
  });

  it("classifies single-subject / single-domain questions as NARROW", () => {
    for (const q of [
      "What tasks do I have in Planner Today?",
      "What do I need to do today?",
      "Tell me everything happening with A&S Wholesalers",
      "How many unpaid invoices does DIAD have?",
      "What is the onboarding status for Imatec?",
    ]) {
      expect(classifyQuestionBreadth(q)).toBe("narrow");
    }
  });

  it("defaults to narrow (does not downgrade indiscriminately)", () => {
    expect(classifyQuestionBreadth("")).toBe("narrow");
    expect(classifyQuestionBreadth("show me the A&S report")).toBe("narrow");
  });
});

describe("broadCoverageComplete", () => {
  it("is false while ANY agency domain is unsupported (current milestone)", () => {
    expect(UNSUPPORTED_AGENCY_KEYS.length).toBeGreaterThan(0); // meetings/finance/etc not built
    const allSupportedChecked = new Set<CoverageKey>(SUPPORTED_AGENCY_KEYS);
    // Even having checked every SUPPORTED agency domain, unsupported ones remain → not complete.
    expect(broadCoverageComplete(allSupportedChecked)).toBe(false);
  });
  it("is false when supported domains are unchecked", () => {
    expect(broadCoverageComplete(new Set())).toBe(false);
  });
});

describe("unexaminedAgencyAreas", () => {
  it("names unchecked supported domains AND all unsupported agency domains", () => {
    const areas = unexaminedAgencyAreas(new Set<CoverageKey>(["tasks_today"]));
    // tasks_today checked ⇒ not listed; other supported + all unsupported ⇒ listed.
    expect(areas).not.toContain("Planner tasks (today)");
    expect(areas).toContain("Meetings / calendar");
    expect(areas).toContain("Finance (QuickBooks/PayFast)");
    expect(areas).toContain("Client communications (email/WhatsApp)");
    expect(areas).toContain("Leads & opportunities (GHL)");
  });
});
