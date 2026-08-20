import { describe, it, expect } from "vitest";
import {
  deriveWebsiteOperational,
  resolveAdsSeoOperational,
  resolveServiceOperational,
  isOperationalEditable,
  isOperationalStatus,
  adminOperationalLabel,
  clientOperationalLabel,
  OPERATIONAL_STATUSES,
  type WebsiteSignals,
} from "./service-operational-state";

const web = (o: Partial<WebsiteSignals>): WebsiteSignals => ({
  liveUrl: null,
  previewUrl: null,
  launchCompleted: false,
  hasRoadmapProgress: false,
  ...o,
});

describe("Website — derived only (Live / In Development / Not Started)", () => {
  it("Live when a live URL exists", () => {
    expect(deriveWebsiteOperational(web({ liveUrl: "https://client.co.za" }))).toBe("active");
  });
  it("Live when the Launch stage is completed", () => {
    expect(deriveWebsiteOperational(web({ launchCompleted: true }))).toBe("active");
  });
  it("In Development when only a preview URL exists", () => {
    expect(deriveWebsiteOperational(web({ previewUrl: "https://preview.test" }))).toBe("in_progress");
  });
  it("In Development on meaningful roadmap progress", () => {
    expect(deriveWebsiteOperational(web({ hasRoadmapProgress: true }))).toBe("in_progress");
  });
  it("Not Started when there are no signals", () => {
    expect(deriveWebsiteOperational(web({}))).toBe("not_started");
  });
  it("live URL wins over an in-progress roadmap (no contradiction)", () => {
    expect(
      deriveWebsiteOperational(web({ liveUrl: "https://client.co.za", hasRoadmapProgress: true }))
    ).toBe("active");
  });
  it("blank/whitespace URLs are treated as absent", () => {
    expect(deriveWebsiteOperational(web({ liveUrl: "  ", previewUrl: "" }))).toBe("not_started");
  });
});

describe("Website — IGNORES any stored operational_status", () => {
  it("stored 'paused'/'active' on the website row have no effect", () => {
    for (const stored of OPERATIONAL_STATUSES) {
      const r = resolveServiceOperational({
        service: "website",
        operationalStatus: stored,
        onboardingStatus: "approved",
        website: web({ previewUrl: "https://preview.test" }),
      });
      expect(r).toBe("in_progress"); // derived from preview, regardless of stored
    }
  });
  it("website is never editable", () => {
    expect(isOperationalEditable("website")).toBe(false);
    expect(isOperationalEditable("google_ads")).toBe(true);
    expect(isOperationalEditable("meta_ads")).toBe(true);
    expect(isOperationalEditable("seo")).toBe(true);
  });
});

describe("Ads/SEO — stored, with the conservative NULL rule", () => {
  it("NULL + untouched (onboarding not begun / missing) → Not Started", () => {
    expect(resolveAdsSeoOperational({ operationalStatus: null, onboardingStatus: "not_started" })).toBe("not_started");
    expect(resolveAdsSeoOperational({ operationalStatus: null, onboardingStatus: null })).toBe("not_started");
  });
  it("NULL + onboarding underway → Setup (never Active)", () => {
    for (const ob of ["in_progress", "submitted"] as const) {
      expect(resolveAdsSeoOperational({ operationalStatus: null, onboardingStatus: ob })).toBe("setup");
    }
  });
  it("NULL + onboarding 'approved' → Setup, NEVER Active", () => {
    const r = resolveAdsSeoOperational({ operationalStatus: null, onboardingStatus: "approved" });
    expect(r).toBe("setup");
    expect(r).not.toBe("active");
  });
  it("NULL never resolves to active or paused, for any onboarding value", () => {
    for (const ob of ["not_started", "in_progress", "submitted", "approved"] as const) {
      const r = resolveAdsSeoOperational({ operationalStatus: null, onboardingStatus: ob });
      expect(r).not.toBe("active");
      expect(r).not.toBe("paused");
    }
  });
  it("explicit Active / Paused / In Progress are preserved verbatim", () => {
    for (const s of ["active", "paused", "in_progress", "setup", "not_started"] as const) {
      expect(resolveAdsSeoOperational({ operationalStatus: s, onboardingStatus: "not_started" })).toBe(s);
    }
  });
  it("explicit value wins even when onboarding would say otherwise", () => {
    expect(resolveAdsSeoOperational({ operationalStatus: "paused", onboardingStatus: "approved" })).toBe("paused");
  });
});

describe("resolveServiceOperational — unified authority", () => {
  it("routes website to derivation and ads/SEO to stored", () => {
    expect(
      resolveServiceOperational({
        service: "google_ads",
        operationalStatus: "active",
        onboardingStatus: "approved",
      })
    ).toBe("active");
    expect(
      resolveServiceOperational({
        service: "seo",
        operationalStatus: null,
        onboardingStatus: "approved",
      })
    ).toBe("setup"); // approved onboarding ≠ active
  });
});

describe("isOperationalStatus — mirrors the 0057 CHECK", () => {
  it("accepts the five canonical values", () => {
    for (const s of OPERATIONAL_STATUSES) expect(isOperationalStatus(s)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "live", "on", "ACTIVE", "deleted"]) expect(isOperationalStatus(bad)).toBe(false);
  });
});

describe("labels", () => {
  it("admin labels are short; website active shows as Live", () => {
    expect(adminOperationalLabel("website", "active")).toBe("Live");
    expect(adminOperationalLabel("google_ads", "active")).toBe("Active");
    expect(adminOperationalLabel("seo", "paused")).toBe("Paused");
    expect(adminOperationalLabel("meta_ads", "setup")).toBe("Setup");
  });
  it("client labels are friendly and per-service", () => {
    expect(clientOperationalLabel("website", "active")).toBe("Live");
    expect(clientOperationalLabel("website", "in_progress")).toBe("In development");
    expect(clientOperationalLabel("google_ads", "active")).toBe("Active");
    expect(clientOperationalLabel("meta_ads", "setup")).toBe("We’re setting things up");
    expect(clientOperationalLabel("seo", "in_progress")).toBe("Getting things running");
    expect(clientOperationalLabel("google_ads", "paused")).toBe("Paused");
    expect(clientOperationalLabel("seo", "not_started")).toBe("Not started yet");
  });
});
