import { describe, it, expect } from "vitest";
import {
  validateBusiness,
  validateServices,
  validateDetails,
  validateGoals,
  validateBudget,
  validateForSubmit,
  isValidEmail,
} from "./intake-validation";

describe("step 1 — business validation", () => {
  it("requires name, business and a valid email", () => {
    expect(validateBusiness({}).ok).toBe(false);
    const r = validateBusiness({ contact_name: "  ", business_name: "", email: "nope" });
    expect(r.errors.contact_name).toBeTruthy();
    expect(r.errors.business_name).toBeTruthy();
    expect(r.errors.email).toBeTruthy();
  });
  it("passes with the three required fields", () => {
    expect(validateBusiness({ contact_name: "Ada", business_name: "Acme", email: "ada@acme.co.za" }).ok).toBe(true);
  });
  it("email check is lenient but sane", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.co")).toBe(false);
  });
  it("phone / website / location are optional (not required)", () => {
    const r = validateBusiness({ contact_name: "Ada", business_name: "Acme", email: "ada@acme.co.za" });
    expect(r.errors.phone).toBeUndefined();
    expect(r.errors.existing_website_url).toBeUndefined();
    expect(r.errors.location).toBeUndefined();
  });
});

describe("step 2 — services validation", () => {
  it("passes with at least one real service", () => {
    expect(validateServices({ selected_services: ["seo"] }).ok).toBe(true);
  });
  it("passes with services_uncertain=true and no services", () => {
    expect(validateServices({ selected_services: [], services_uncertain: true }).ok).toBe(true);
  });
  it("fails when nothing is chosen and not uncertain", () => {
    expect(validateServices({ selected_services: [], services_uncertain: false }).ok).toBe(false);
    expect(validateServices({}).ok).toBe(false);
  });
  it("unknown-only selection with no uncertainty fails (unknowns don't count)", () => {
    expect(validateServices({ selected_services: ["bogus"] }).ok).toBe(false);
  });
});

describe("steps 3–5 — optional, reject only present-but-invalid values", () => {
  it("empty details/goals/budget are valid", () => {
    expect(validateDetails({}).ok).toBe(true);
    expect(validateGoals({}).ok).toBe(true);
    expect(validateBudget({}).ok).toBe(true);
  });
  it("valid enum values accepted", () => {
    expect(validateDetails({ website_goal_primary: "Get leads", google_ads_running: "Yes" }).ok).toBe(true);
    expect(validateBudget({ investment_band: "Under R5,000", readiness: "Just exploring" }).ok).toBe(true);
    expect(validateGoals({ goals: ["More leads", "Online sales"] }).ok).toBe(true);
  });
  it("unknown enum / goal values rejected", () => {
    expect(validateDetails({ website_goal_primary: "???" }).ok).toBe(false);
    expect(validateBudget({ investment_band: "R9m" }).ok).toBe(false);
    expect(validateGoals({ goals: ["More leads", "???"] }).ok).toBe(false);
  });
});

describe("validateForSubmit — only steps 1 + 2 are hard requirements", () => {
  it("passes a minimal but complete submission", () => {
    expect(
      validateForSubmit({
        contact_name: "Ada",
        business_name: "Acme",
        email: "ada@acme.co.za",
        services_uncertain: true,
      }).ok
    ).toBe(true);
  });
  it("fails without email or a service choice", () => {
    expect(validateForSubmit({ contact_name: "Ada", business_name: "Acme" }).ok).toBe(false);
  });
});
