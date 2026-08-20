import { describe, it, expect } from "vitest";
import { resolveSection } from "./client-workspace-sections";

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
