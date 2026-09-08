import { describe, it, expect } from "vitest";
import {
  advance,
  back,
  editTarget,
  validateSection,
  canAdvanceFrom,
  canCreateDraft,
  canSubmitNow,
  canProceed,
  classifyKind,
  isClosedOutcome,
  isRetryableOutcome,
  serviceDetailPanels,
} from "./intake-flow-machine";
import { normalizeIntakeData } from "./intake-normalize";

const base = { contact_name: "Ada", business_name: "Acme", email: "ada@acme.co.za" };

describe("section navigation", () => {
  it("business → services → details(first panel) with real services", () => {
    const data = normalizeIntakeData({ ...base, selected_services: ["website", "seo"] });
    expect(advance("business", 0, data)).toEqual({ section: "services", panel: 0 });
    expect(advance("services", 0, data)).toEqual({ section: "details", panel: 0 });
  });

  it("Details steps one mini-panel per selected service, then → goals", () => {
    const data = normalizeIntakeData({ ...base, selected_services: ["website", "google_ads", "seo"] });
    expect(serviceDetailPanels(data)).toEqual(["website", "google_ads", "seo"]);
    expect(advance("details", 0, data)).toEqual({ section: "details", panel: 1 });
    expect(advance("details", 1, data)).toEqual({ section: "details", panel: 2 });
    expect(advance("details", 2, data)).toEqual({ section: "goals", panel: 0 }); // last panel → goals
  });

  it("unsure → services skips Details entirely (straight to goals)", () => {
    const data = normalizeIntakeData({ ...base, services_uncertain: true });
    expect(serviceDetailPanels(data)).toEqual([]);
    expect(advance("services", 0, data)).toEqual({ section: "goals", panel: 0 });
  });

  it("goals → budget → review; review advance means SUBMIT", () => {
    const data = normalizeIntakeData({ ...base, services_uncertain: true });
    expect(advance("goals", 0, data)).toEqual({ section: "budget", panel: 0 });
    expect(advance("budget", 0, data)).toEqual({ section: "review", panel: 0 });
    expect(advance("review", 0, data)).toEqual({ section: "review", panel: 0, submit: true });
  });

  it("back mirrors forward, including Details panel stepping", () => {
    const data = normalizeIntakeData({ ...base, selected_services: ["website", "seo"] });
    expect(back("services", 0, data)).toEqual({ section: "business", panel: 0 });
    expect(back("details", 1, data)).toEqual({ section: "details", panel: 0 });
    expect(back("details", 0, data)).toEqual({ section: "services", panel: 0 });
    expect(back("goals", 0, data)).toEqual({ section: "details", panel: 1 }); // last panel of 2
    expect(back("business", 0, data)).toBeNull(); // at the start
  });

  it("back from goals skips Details when unsure", () => {
    const data = normalizeIntakeData({ ...base, services_uncertain: true });
    expect(back("goals", 0, data)).toEqual({ section: "services", panel: 0 });
  });

  it("editTarget jumps to the section (Details at first panel)", () => {
    expect(editTarget("budget")).toEqual({ section: "budget", panel: 0 });
    expect(editTarget("details")).toEqual({ section: "details", panel: 0 });
  });
});

describe("service answers survive deselection / reselection (normalize + panels)", () => {
  it("deselecting a service hides its panel but keeps its stored answer; reselect restores", () => {
    let data = normalizeIntakeData({
      ...base,
      selected_services: ["website", "seo"],
      website_goal_primary: "Get leads",
      keywords: ["plumber"],
    });
    expect(serviceDetailPanels(data)).toEqual(["website", "seo"]);

    // Deselect website (keep seo). Panel disappears but the stored answer remains.
    data = normalizeIntakeData({ ...data, selected_services: ["seo"] });
    expect(serviceDetailPanels(data)).toEqual(["seo"]);
    expect(data.website_goal_primary).toBe("Get leads"); // NOT erased

    // Reselect website — panel returns, answer rehydrates.
    data = normalizeIntakeData({ ...data, selected_services: ["seo", "website"] });
    expect(serviceDetailPanels(data)).toEqual(["seo", "website"]);
    expect(data.website_goal_primary).toBe("Get leads");
  });
});

describe("validation gate per section", () => {
  it("business requires name/business/email", () => {
    expect(canAdvanceFrom("business", {})).toBe(false);
    expect(canAdvanceFrom("business", base)).toBe(true);
  });
  it("services require a real service OR unsure", () => {
    expect(validateSection("services", {}).ok).toBe(false);
    expect(canAdvanceFrom("services", { selected_services: ["seo"] })).toBe(true);
    expect(canAdvanceFrom("services", { services_uncertain: true })).toBe(true);
  });
  it("optional sections never trap on blanks", () => {
    expect(canAdvanceFrom("details", {})).toBe(true);
    expect(canAdvanceFrom("goals", {})).toBe(true);
    expect(canAdvanceFrom("budget", {})).toBe(true);
  });
  it("optional sections still reject present-but-invalid enums", () => {
    expect(canAdvanceFrom("budget", { investment_band: "not an option" })).toBe(false);
  });
});

describe("write guards", () => {
  it("create only when no token and not already creating", () => {
    expect(canCreateDraft({ creating: false, token: null })).toBe(true);
    expect(canCreateDraft({ creating: true, token: null })).toBe(false); // in flight (double-click)
    expect(canCreateDraft({ creating: false, token: "t" })).toBe(false); // already created
  });
  it("submit only with a token and not already submitting", () => {
    expect(canSubmitNow({ submitting: false, token: "t" })).toBe(true);
    expect(canSubmitNow({ submitting: true, token: "t" })).toBe(false); // double-submit blocked
    expect(canSubmitNow({ submitting: false, token: null })).toBe(false);
  });
  it("advance waits for a confirmed save; blocks while saving or after a save error", () => {
    expect(canProceed("idle")).toBe(true);
    expect(canProceed("saved")).toBe(true);
    expect(canProceed("saving")).toBe(false); // must wait for confirmation
    expect(canProceed("error")).toBe(false); // failed save blocks advance
  });
});

describe("server-result classification", () => {
  it("maps kinds to outcomes", () => {
    expect(classifyKind("success")).toBe("success");
    expect(classifyKind("already_submitted")).toBe("already_submitted");
    expect(classifyKind("validation_error")).toBe("validation");
    expect(classifyKind("verification_failed")).toBe("verification");
    expect(classifyKind("configuration_error")).toBe("config");
    expect(classifyKind("conflict")).toBe("conflict");
    expect(classifyKind("expired")).toBe("expired");
    expect(classifyKind("invalid_or_closed")).toBe("closed");
    expect(classifyKind("save_failed")).toBe("save_failed");
    expect(classifyKind("weird")).toBe("save_failed"); // safe default
  });
  it("closed vs retryable outcomes", () => {
    expect(isClosedOutcome("expired")).toBe(true);
    expect(isClosedOutcome("closed")).toBe(true);
    expect(isClosedOutcome("conflict")).toBe(false);
    expect(isRetryableOutcome("verification")).toBe(true);
    expect(isRetryableOutcome("conflict")).toBe(true);
    expect(isRetryableOutcome("save_failed")).toBe(true);
    expect(isRetryableOutcome("success")).toBe(false);
  });
});
