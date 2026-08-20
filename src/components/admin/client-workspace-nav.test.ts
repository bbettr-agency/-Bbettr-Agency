import { describe, it, expect } from "vitest";
import {
  resolveSection,
  CAPABILITY_SECTION,
  SECTION_IDS,
  DOC_TABS,
} from "./client-workspace-sections";

describe("resolveSection — 9 legacy sections → 4 primary (bookmark safety)", () => {
  it("maps every legacy ?section= value to its new home", () => {
    const map: Record<string, string> = {
      overview: "command-centre",
      intake: "work", onboarding: "work", progress: "work", updates: "work",
      billing: "money",
      contracts: "documents", files: "documents", reports: "documents",
    };
    for (const [legacy, target] of Object.entries(map)) {
      expect(resolveSection(legacy)).toBe(target);
    }
  });
  it("passes through the 4 new ids", () => {
    for (const id of ["command-centre", "work", "money", "documents"]) {
      expect(resolveSection(id)).toBe(id);
    }
  });
  it("defaults unknown/null to command-centre", () => {
    expect(resolveSection(null)).toBe("command-centre");
    expect(resolveSection("nope")).toBe("command-centre");
    expect(resolveSection("")).toBe("command-centre");
  });
});

describe("CAPABILITY_SECTION — 9→4 collapse orphans no manager/action", () => {
  it("assigns every legacy capability to a valid section id", () => {
    for (const sec of Object.values(CAPABILITY_SECTION)) {
      expect(SECTION_IDS).toContain(sec);
    }
  });

  it("covers all four sections (none is an accidental empty shell)", () => {
    const covered = new Set(Object.values(CAPABILITY_SECTION));
    for (const id of SECTION_IDS) expect(covered.has(id)).toBe(true);
  });

  it("keeps client billing in Money, never merged into Documents or Invoice Requests", () => {
    expect(CAPABILITY_SECTION.billing).toBe("money");
    expect(CAPABILITY_SECTION["billing-details"]).toBe("money");
  });

  it("keeps delivery in Work and documents in Documents", () => {
    for (const c of ["readiness", "roadmap", "activity", "post-update", "intake", "onboarding-answers"]) {
      expect(CAPABILITY_SECTION[c]).toBe("work");
    }
    for (const c of ["contracts", "files", "reports", "report-authoring"]) {
      expect(CAPABILITY_SECTION[c]).toBe("documents");
    }
  });
});

describe("DOC_TABS — Documents is one destination with three tabs", () => {
  it("is exactly Files/Contracts/Reports, in order", () => {
    expect(DOC_TABS).toEqual(["files", "contracts", "reports"]);
  });
});
