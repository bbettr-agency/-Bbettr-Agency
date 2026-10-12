import { describe, it, expect } from "vitest";
import {
  classifyQuestionBreadth,
  broadCoverageComplete,
  buildCoverageBuckets,
  recordContribution,
  aggregateMetricContribution,
  SUPPORTED_AGENCY_KEYS,
  UNSUPPORTED_AGENCY_KEYS,
  type CoverageMap,
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

describe("aggregateMetricContribution — metric → domain (SIGNAL, agency)", () => {
  it("maps each metric to its actual domain at signal level", () => {
    expect(aggregateMetricContribution("incomplete_onboarding")).toEqual({ domain: "onboarding", level: "signal", scope: { breadth: "agency" } });
    expect(aggregateMetricContribution("unpaid_invoices")).toEqual({ domain: "invoices", level: "signal", scope: { breadth: "agency" } });
    expect(aggregateMetricContribution("stale_clients")).toEqual({ domain: "client_updates", level: "signal", scope: { breadth: "agency" } });
    expect(aggregateMetricContribution("stage_distribution")).toEqual({ domain: "project_stages", level: "signal", scope: { breadth: "agency" } });
    expect(aggregateMetricContribution("clients_by_status")).toEqual({ domain: "clients", level: "signal", scope: { breadth: "agency" } });
    for (const m of ["open_tasks", "overdue_tasks", "tasks_due_today", "tasks_scheduled_today"]) {
      expect(aggregateMetricContribution(m)).toEqual({ domain: "tasks_today", level: "signal", scope: { breadth: "agency" } });
    }
    expect(aggregateMetricContribution("bogus")).toBeNull();
  });
  it("NEVER marks an aggregate as full coverage", () => {
    for (const m of Object.keys({ incomplete_onboarding: 1, unpaid_invoices: 1, stale_clients: 1 })) {
      expect(aggregateMetricContribution(m)?.level).toBe("signal");
    }
  });
});

describe("broadCoverageComplete", () => {
  it("is false while ANY agency domain is unsupported (current milestone), even with all signals", () => {
    expect(UNSUPPORTED_AGENCY_KEYS.length).toBeGreaterThan(0); // meetings/finance/etc not built
    const map: CoverageMap = new Map();
    for (const k of SUPPORTED_AGENCY_KEYS) recordContribution(map, { domain: k, level: "signal", scope: { breadth: "agency" } });
    expect(broadCoverageComplete(map)).toBe(false); // signals + unsupported remain
  });
  it("is false when a supported domain has only signal (not agency-full)", () => {
    const map: CoverageMap = new Map();
    recordContribution(map, { domain: "clients", level: "signal", scope: { breadth: "agency" } });
    expect(broadCoverageComplete(map)).toBe(false);
  });
});

describe("recordContribution — level/scope folding (no escalation)", () => {
  it("a FULL at a narrow (viewer) scope does NOT set agencyFull", () => {
    const map: CoverageMap = new Map();
    recordContribution(map, { domain: "tasks_today", level: "full", scope: { breadth: "viewer" } });
    expect(map.get("tasks_today")).toEqual({ level: "full", agencyFull: false });
  });
  it("keeps the strongest level; agencyFull only from a FULL+agency contribution", () => {
    const map: CoverageMap = new Map();
    recordContribution(map, { domain: "clients", level: "signal", scope: { breadth: "agency" } });
    recordContribution(map, { domain: "clients", level: "full", scope: { breadth: "agency" } });
    expect(map.get("clients")).toEqual({ level: "full", agencyFull: true });
  });
});

describe("buildCoverageBuckets — full / signal-only / not-checked", () => {
  it("separates a signal-checked domain from not-checked ones (broad question)", () => {
    const map: CoverageMap = new Map();
    recordContribution(map, { domain: "onboarding", level: "signal", scope: { breadth: "agency" } });
    recordContribution(map, { domain: "tasks_today", level: "full", scope: { breadth: "viewer" } });
    const b = buildCoverageBuckets({ map, breadth: "broad", askedUnsupported: [] });
    expect(b.full).toContain("Planner tasks (today)"); // full
    expect(b.signalOnly).toContain("Onboarding status"); // signal-only
    // onboarding must NOT be reported as not-checked (its signal WAS retrieved):
    expect(b.notChecked).not.toContain("Onboarding status");
    // unsupported agency domains surface as not-checked:
    expect(b.notChecked).toContain("Meetings / calendar");
    expect(b.notChecked).toContain("Finance (QuickBooks/PayFast)");
  });
  it("narrow question only adds explicitly-asked unsupported domains to not-checked", () => {
    const map: CoverageMap = new Map();
    recordContribution(map, { domain: "tasks_today", level: "full", scope: { breadth: "viewer" } });
    const b = buildCoverageBuckets({ map, breadth: "narrow", askedUnsupported: ["recurring_reminders"] });
    expect(b.full).toContain("Planner tasks (today)");
    expect(b.notChecked).toEqual(["Recurring reminders (full)"]); // not the whole agency universe
  });
});
