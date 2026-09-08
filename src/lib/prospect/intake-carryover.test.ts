import { describe, it, expect } from "vitest";
import {
  onboardingFieldNames,
  pickCarryOverData,
  CARRIED_OVER_ONBOARDING_STATUS,
} from "./intake-carryover";

describe("intake → onboarding carry-over mapping", () => {
  it("exposes the real onboarding field names for a service", () => {
    const seo = onboardingFieldNames("seo");
    // From services.ts SEO definition (stable keys).
    expect(seo.has("website")).toBe(true);
    expect(seo.has("keywords")).toBe(true);
    expect(seo.size).toBeGreaterThan(0);
  });

  it("keeps only keys that are real onboarding fields for the service", () => {
    const picked = pickCarryOverData(
      {
        website: "https://acme.test",       // real seo field → kept
        keywords: ["plumber", "geyser"],     // real seo field → kept
        budget_context: "R10k/mo",           // intake-only → dropped
        __mode: "assisted",                  // reserved key → dropped
        nonsense: 1,                          // unknown → dropped
      },
      "seo"
    );
    expect(picked).toEqual({ website: "https://acme.test", keywords: ["plumber", "geyser"] });
  });

  it("drops undefined values and returns {} for an unknown-shaped blob", () => {
    expect(pickCarryOverData({ website: undefined }, "seo")).toEqual({});
    expect(pickCarryOverData({}, "website")).toEqual({});
  });

  it("is service-scoped: a website-only key does not carry into seo", () => {
    const websiteNames = onboardingFieldNames("website");
    // pick a key that exists for website but (presumably) not seo
    const websiteOnly = [...websiteNames].find((n) => !onboardingFieldNames("seo").has(n));
    expect(websiteOnly).toBeTruthy();
    const picked = pickCarryOverData({ [websiteOnly as string]: "x" }, "seo");
    expect(picked).toEqual({});
  });

  it("LOCKED: carrying answers never implies onboarding has started", () => {
    // A pre-sales intake is a separate stage from formal onboarding. Conversion
    // seeds data only; the onboarding status stays not_started.
    expect(CARRIED_OVER_ONBOARDING_STATUS).toBe("not_started");
  });
});
