import { describe, it, expect } from "vitest";
import { resumeSection, isBusinessComplete, isServicesDecided } from "./intake-resume";
import { normalizeIntakeData } from "./intake-normalize";

const base = {
  contact_name: "Ada",
  business_name: "Acme",
  email: "ada@acme.co.za",
};

describe("resumeSection — deterministic, non-trapping", () => {
  it("incomplete business → business", () => {
    expect(resumeSection(normalizeIntakeData({ contact_name: "Ada" }))).toBe("business");
    expect(resumeSection(normalizeIntakeData({ ...base, email: "not-an-email" }))).toBe("business");
    expect(resumeSection({})).toBe("business");
  });

  it("business done but services undecided → services", () => {
    expect(resumeSection(normalizeIntakeData({ ...base }))).toBe("services");
    expect(resumeSection(normalizeIntakeData({ ...base, selected_services: [] }))).toBe("services");
  });

  it("real services chosen, no details yet → details", () => {
    expect(resumeSection(normalizeIntakeData({ ...base, selected_services: ["website"] }))).toBe("details");
  });

  it("unsure → details is skipped, resume at goals", () => {
    expect(resumeSection(normalizeIntakeData({ ...base, services_uncertain: true }))).toBe("goals");
  });

  it("real services with some detail answered → goals", () => {
    expect(
      resumeSection(
        normalizeIntakeData({ ...base, selected_services: ["website"], website_goal_primary: "Get leads" })
      )
    ).toBe("goals");
  });

  it("goals answered → budget", () => {
    expect(
      resumeSection(normalizeIntakeData({ ...base, selected_services: ["seo"], goals: ["More leads"] }))
    ).toBe("budget");
    // goals_note alone also counts as goals progress
    expect(
      resumeSection(normalizeIntakeData({ ...base, services_uncertain: true, goals_note: "hi" }))
    ).toBe("budget");
  });

  it("budget/readiness answered → review", () => {
    expect(
      resumeSection(normalizeIntakeData({ ...base, services_uncertain: true, investment_band: "Under R5,000" }))
    ).toBe("review");
    expect(
      resumeSection(
        normalizeIntakeData({ ...base, selected_services: ["website"], readiness: "Just exploring" })
      )
    ).toBe("review");
  });

  it("is total — always returns a valid section for arbitrary input", () => {
    for (const input of [null, undefined, 42, "x", [], { selected_services: "nope" }]) {
      expect(typeof resumeSection(input)).toBe("string");
    }
  });

  it("never resumes at a required gate once that gate is satisfied", () => {
    // A fully-answered draft resumes at review, not back at business/services.
    const full = normalizeIntakeData({
      ...base,
      selected_services: ["website", "seo"],
      website_goal_primary: "Get leads",
      keywords: ["plumber"],
      goals: ["More leads"],
      investment_band: "R5,000 – R15,000",
      readiness: "Ready to get started",
    });
    expect(resumeSection(full)).toBe("review");
  });
});

describe("resume gate predicates", () => {
  it("isBusinessComplete mirrors validateBusiness", () => {
    expect(isBusinessComplete(base)).toBe(true);
    expect(isBusinessComplete({ contact_name: "Ada", business_name: "Acme" })).toBe(false);
  });
  it("isServicesDecided true for real service or uncertainty only", () => {
    expect(isServicesDecided({ selected_services: ["seo"] })).toBe(true);
    expect(isServicesDecided({ services_uncertain: true })).toBe(true);
    expect(isServicesDecided({ selected_services: [] })).toBe(false);
    expect(isServicesDecided({ selected_services: ["bogus"] })).toBe(false); // outside catalog
  });
});
