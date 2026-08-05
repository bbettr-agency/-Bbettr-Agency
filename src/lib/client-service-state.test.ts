import { describe, it, expect } from "vitest";
import { deriveServiceStateRows, SERVICE_STATE_LABEL, isActive } from "./client-service-state";
import { SERVICE_LIST } from "@/lib/services";

describe("deriveServiceStateRows", () => {
  it("returns one row per supported service, in catalogue order, even with none assigned", () => {
    const rows = deriveServiceStateRows([]);
    expect(rows.map((r) => r.service)).toEqual(SERVICE_LIST.map((s) => s.id));
    expect(rows.every((r) => r.state === "not_added")).toBe(true);
  });

  it("maps EVERY onboarding_status to the correct locked UI state", () => {
    const rows = deriveServiceStateRows([
      { service: "website", onboarding_status: "approved", created_at: "2026-01-01T00:00:00Z" },
      { service: "google_ads", onboarding_status: "not_started", created_at: "2026-02-01T00:00:00Z" },
      { service: "meta_ads", onboarding_status: "in_progress" },
      { service: "seo", onboarding_status: "submitted" },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.service, r]));
    expect(by.website.state).toBe("onboarding_completed");
    expect(by.google_ads.state).toBe("onboarding_required");
    expect(by.meta_ads.state).toBe("onboarding_in_progress");
    expect(by.seo.state).toBe("onboarding_submitted");
  });

  it("carries the real onboarding status + added date for assigned services; null for not-added", () => {
    const rows = deriveServiceStateRows([{ service: "website", onboarding_status: "approved", created_at: "2026-01-01T00:00:00Z" }]);
    const website = rows.find((r) => r.service === "website")!;
    const seo = rows.find((r) => r.service === "seo")!;
    expect(website).toMatchObject({ onboardingStatus: "approved", addedAt: "2026-01-01T00:00:00Z" });
    expect(seo).toMatchObject({ state: "not_added", onboardingStatus: null, addedAt: null });
  });

  it("labels are the locked admin strings; isActive is true for any assigned state", () => {
    expect(SERVICE_STATE_LABEL.not_added).toBe("Not Added");
    expect(SERVICE_STATE_LABEL.onboarding_required).toBe("Active · Onboarding Required");
    expect(SERVICE_STATE_LABEL.onboarding_completed).toBe("Active · Onboarding Completed");
    expect(isActive("not_added")).toBe(false);
    expect(isActive("onboarding_required")).toBe(true);
    expect(isActive("onboarding_submitted")).toBe(true);
  });
});
