import { describe, it, expect } from "vitest";
import {
  onboardingPdfFilename,
  buildOnboardingPdfModel,
  isOnboardingExportable,
} from "./onboarding-pdf";
import { presentOnboarding } from "./onboarding-present";

describe("onboardingPdfFilename — safe + sensible", () => {
  it("slugifies business + service into a clean filename", () => {
    expect(onboardingPdfFilename("A&S Wholesalers Haier Hvac", "Website Design")).toBe(
      "A-S-Wholesalers-Haier-Hvac-Website-Design-Onboarding.pdf"
    );
  });
  it("falls back to 'Client' when the business name is missing/empty", () => {
    expect(onboardingPdfFilename(null, "SEO")).toBe("Client-SEO-Onboarding.pdf");
    expect(onboardingPdfFilename("   ", "SEO")).toBe("Client-SEO-Onboarding.pdf");
  });
  it("strips path/traversal/unsafe characters (no separators survive)", () => {
    const f = onboardingPdfFilename("../../etc/passwd", "Web \"site\"/Design");
    expect(f).not.toMatch(/[\\/]/);
    expect(f).not.toContain("..");
    expect(f).not.toContain('"');
    expect(f.endsWith("-Onboarding.pdf")).toBe(true);
  });
});

describe("isOnboardingExportable — content-based, not submit-state", () => {
  it("is exportable whenever real answers exist, regardless of status", () => {
    // A filled draft (in_progress) still exports — the admin already sees these
    // answers on screen; the PDF is the same content. (This is the bug fix: the
    // button was hidden for in_progress submissions that had complete answers.)
    expect(isOnboardingExportable("website", { business_name: "Acme", contact_email: "a@b.co" })).toBe(true);
  });
  it("is NOT exportable when there is no renderable content (empty / not started)", () => {
    expect(isOnboardingExportable("website", {})).toBe(false);
    expect(isOnboardingExportable("website", null)).toBe(false);
    // Only reserved/unknown-empty keys → still nothing to show.
    expect(isOnboardingExportable("website", { _internal: { x: 1 } })).toBe(false);
  });
});

describe("buildOnboardingPdfModel — reuses the presenter, no drift, no raw fields", () => {
  const data = {
    business_name: "A&S Wholesalers",
    business_description: "We distribute Haier airconditioning",
    contact_email: "haier@answholesalers.co.za",
    required_pages: ["Home", "Contact"],
    _internal: { secret: 1 }, // reserved — must never surface
    legacy_field: "kept",
  };

  it("presented === presentOnboarding(service, data) exactly (single source of truth)", () => {
    const model = buildOnboardingPdfModel({
      service: "website",
      data,
      businessName: "A&S Wholesalers",
      status: "submitted",
      submittedAt: "2026-09-08T10:00:00Z",
    });
    expect(model.presented).toEqual(presentOnboarding("website", data));
  });

  it("builds correct meta with the human service name + agency", () => {
    const model = buildOnboardingPdfModel({
      service: "website",
      data,
      businessName: "A&S Wholesalers",
      status: "approved",
      submittedAt: null,
    });
    expect(model.meta).toEqual({
      agency: "Bbettr Agency",
      businessName: "A&S Wholesalers",
      serviceName: "Website Design",
      status: "approved",
      submittedAt: null,
    });
  });

  it("never surfaces reserved/internal keys or raw JSON", () => {
    const model = buildOnboardingPdfModel({
      service: "website",
      data,
      businessName: "A&S Wholesalers",
      status: "submitted",
      submittedAt: null,
    });
    const json = JSON.stringify(model.presented);
    expect(json).not.toContain("_internal");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("[object Object]");
  });

  it("falls back to 'Client' business name when blank", () => {
    const model = buildOnboardingPdfModel({
      service: "seo",
      data: {},
      businessName: "",
      status: "submitted",
      submittedAt: null,
    });
    expect(model.meta.businessName).toBe("Client");
    expect(model.presented.hasContent).toBe(false); // empty onboarding → no sections
  });
});
