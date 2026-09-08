import { describe, it, expect } from "vitest";
import {
  BUSINESS_FIELDS,
  SERVICE_FIELDS,
  GOALS_FIELDS,
  BUDGET_FIELDS,
  ALL_SERVICE_FIELDS,
  KNOWN_FIELD_NAMES,
  REVIEW_GROUPS,
  isReservedIntakeKey,
} from "./intake-schema";
import { INTAKE_SERVICE_IDS } from "./intake-lifecycle";

describe("public intake schema", () => {
  it("step 1 requires name, business and email; the rest optional", () => {
    const req = BUSINESS_FIELDS.filter((f) => f.required).map((f) => f.name);
    expect(req).toEqual(["contact_name", "business_name", "email"]);
    const names = BUSINESS_FIELDS.map((f) => f.name);
    expect(names).toEqual(["contact_name", "business_name", "email", "phone", "existing_website_url", "location"]);
  });

  it("defines service-detail questions for every canonical service", () => {
    for (const svc of INTAKE_SERVICE_IDS) expect(SERVICE_FIELDS[svc].length).toBeGreaterThan(0);
    expect(SERVICE_FIELDS.website.map((f) => f.name)).toContain("website_goal_primary");
    expect(SERVICE_FIELDS.seo.map((f) => f.name)).toContain("keywords");
    expect(SERVICE_FIELDS.meta_ads.map((f) => f.name)).toEqual(["meta_ads_running", "meta_social_handles"]);
  });

  it("never repeats common Website/location questions inside service details", () => {
    const serviceNames = ALL_SERVICE_FIELDS.map((f) => f.name);
    expect(serviceNames).not.toContain("existing_website_url"); // taken from step 1
    expect(serviceNames).not.toContain("location"); // taken from step 1
  });

  it("annotates only genuinely onboarding-compatible keys as carryOver", () => {
    const carry = [...BUSINESS_FIELDS, ...ALL_SERVICE_FIELDS].filter((f) => f.carryOver).map((f) => f.name);
    expect(carry.sort()).toEqual(["existing_website_url", "keywords"]);
  });

  it("exposes review grouping metadata for all six-ish sections", () => {
    expect(REVIEW_GROUPS.map((g) => g.section)).toEqual(["business", "services", "details", "goals", "budget"]);
    expect(REVIEW_GROUPS.find((g) => g.section === "goals")!.fieldNames).toEqual(
      GOALS_FIELDS.map((f) => f.name)
    );
    expect(REVIEW_GROUPS.find((g) => g.section === "budget")!.fieldNames).toEqual(
      BUDGET_FIELDS.map((f) => f.name)
    );
  });

  it("KNOWN_FIELD_NAMES excludes reserved/meta keys", () => {
    expect(KNOWN_FIELD_NAMES.has("contact_name")).toBe(true);
    expect(KNOWN_FIELD_NAMES.has("_prefill")).toBe(false);
    expect(isReservedIntakeKey("_prefill")).toBe(true);
    expect(isReservedIntakeKey("contact_name")).toBe(false);
  });
});
