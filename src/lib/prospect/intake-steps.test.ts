import { describe, it, expect } from "vitest";
import {
  INTAKE_SECTIONS,
  INTAKE_SECTION_COUNT,
  nextSection,
  prevSection,
  progressFor,
} from "./intake-steps";

describe("intake sections — fixed six-section structure", () => {
  it("has exactly six sections with fixed indices 1..6", () => {
    expect(INTAKE_SECTION_COUNT).toBe(6);
    expect(INTAKE_SECTIONS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(INTAKE_SECTIONS.map((s) => s.id)).toEqual([
      "business", "services", "details", "goals", "budget", "review",
    ]);
  });

  it("progress denominator is always 6 and never shrinks", () => {
    for (const s of INTAKE_SECTIONS) {
      expect(progressFor(s.id).count).toBe(6);
      expect(progressFor(s.id).index).toBe(s.index);
    }
    expect(progressFor("goals").label).toBe("Your goals");
  });
});

describe("navigation when the prospect knows what they want (not uncertain)", () => {
  const opts = { servicesUncertain: false };
  it("visits every section in order incl. details", () => {
    expect(nextSection("services", opts)).toBe("details");
    expect(nextSection("details", opts)).toBe("goals");
    expect(prevSection("goals", opts)).toBe("details");
  });
  it("ends after review", () => {
    expect(nextSection("review", opts)).toBeNull();
    expect(prevSection("business", opts)).toBeNull();
  });
});

describe("navigation when 'I'm not sure yet' (details skipped, denominator unchanged)", () => {
  const opts = { servicesUncertain: true };
  it("skips details forward (services → goals) without changing indices", () => {
    expect(nextSection("services", opts)).toBe("goals");
    // The section that IS shown still reports its fixed 4-of-6 identity.
    expect(progressFor("goals")).toMatchObject({ index: 4, count: 6, label: "Your goals" });
  });
  it("skips details backward (goals → services)", () => {
    expect(prevSection("goals", opts)).toBe("services");
  });
  it("never lands on the skipped details section", () => {
    let id: string | null = "business";
    const visited: string[] = [];
    while (id) { visited.push(id); id = nextSection(id as never, opts); }
    expect(visited).not.toContain("details");
    expect(visited).toEqual(["business", "services", "goals", "budget", "review"]);
  });
});
