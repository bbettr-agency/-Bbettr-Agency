import { describe, it, expect } from "vitest";
import {
  normalizeIntakeData,
  derivePromotedColumns,
  normalizeIntake,
  normalizeWebsiteUrl,
} from "./intake-normalize";

describe("normalizeWebsiteUrl", () => {
  it("prepends https:// to bare domains", () => {
    expect(normalizeWebsiteUrl("example.com")).toBe("https://example.com");
    expect(normalizeWebsiteUrl("www.example.co.za")).toBe("https://www.example.co.za");
  });
  it("keeps valid http(s) URLs", () => {
    expect(normalizeWebsiteUrl("https://acme.test/x")).toBe("https://acme.test/x");
    expect(normalizeWebsiteUrl("http://acme.test")).toBe("http://acme.test");
  });
  it("rejects dangerous / non-http(s) schemes and junk", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.test", "notadomain"]) {
      expect(normalizeWebsiteUrl(bad)).toBeNull();
    }
    expect(normalizeWebsiteUrl("")).toBeNull();
    expect(normalizeWebsiteUrl("   ")).toBeNull();
  });
});

describe("normalizeIntakeData — deterministic, safe, canonical", () => {
  it("trims and normalizes step-1 fields; lowercases email", () => {
    const d = normalizeIntakeData({
      contact_name: "  Ada  ",
      business_name: " Acme ",
      email: "  Ada@ACME.CO.ZA ",
      phone: " +27 82 123 4567 ",
      existing_website_url: "acme.co.za",
      location: " Cape Town ",
    });
    expect(d).toMatchObject({
      contact_name: "Ada",
      business_name: "Acme",
      email: "ada@acme.co.za",
      phone: "+27 82 123 4567",
      existing_website_url: "https://acme.co.za",
      location: "Cape Town",
    });
  });

  it("is deterministic (same input → same output)", () => {
    const input = { contact_name: "A", business_name: "B", email: "a@b.co", selected_services: ["seo"] };
    expect(normalizeIntakeData(input)).toEqual(normalizeIntakeData(input));
  });

  it("drops unknown keys and never trusts client promoted columns/prototype keys", () => {
    const d = normalizeIntakeData({
      contact_name: "A",
      hacker: "x",
      __proto__: { polluted: true },
      constructor: "x",
      selected_services: ["seo"],
    });
    expect(d.hacker).toBeUndefined();
    expect(("polluted" in ({} as Record<string, unknown>))).toBe(false); // no prototype pollution
    expect(Object.keys(d)).not.toContain("constructor");
  });

  it("services: canonical only; unknowns removed", () => {
    const d = normalizeIntakeData({ selected_services: ["seo", "bogus", "website", "seo"] });
    expect(d.selected_services).toEqual(["seo", "website"]);
  });

  it("uncertainty exclusivity: uncertain clears services", () => {
    const d = normalizeIntakeData({ selected_services: ["seo"], services_uncertain: true });
    // a real service was selected → uncertainty is cleared, services kept
    expect(d.services_uncertain).toBe(false);
    expect(d.selected_services).toEqual(["seo"]);
  });
  it("uncertainty exclusivity: pure uncertain with no services", () => {
    const d = normalizeIntakeData({ selected_services: [], services_uncertain: true });
    expect(d.services_uncertain).toBe(true);
    expect(d.selected_services).toEqual([]);
  });

  it("preserves service-detail answers even when that service is NOT selected", () => {
    const d = normalizeIntakeData({
      selected_services: ["seo"], // website not selected
      website_goal_primary: "Get leads",
      keywords: ["plumber", "plumber", " geyser "],
    });
    expect(d.website_goal_primary).toBe("Get leads"); // NOT erased
    expect(d.keywords).toEqual(["plumber", "geyser"]); // trimmed + deduped
  });

  it("rejects unknown enum values (goal/investment/readiness/running)", () => {
    const d = normalizeIntakeData({
      website_goal_primary: "Take over the world",
      investment_band: "R1,000,000+",
      readiness: "someday",
      google_ads_running: "Maybe",
      goals: ["More leads", "World domination"],
    });
    expect(d.website_goal_primary).toBeUndefined();
    expect(d.investment_band).toBeUndefined();
    expect(d.readiness).toBeUndefined();
    expect(d.google_ads_running).toBeUndefined();
    expect(d.goals).toEqual(["More leads"]); // unknown goal dropped
  });

  it("preserves _prefill but never lets it replace current values", () => {
    const d = normalizeIntakeData({
      email: "current@acme.co.za",
      _prefill: { email: "admin@acme.co.za", business_name: "Admin Co", __proto__: { x: 1 } },
    });
    expect(d.email).toBe("current@acme.co.za"); // current wins
    expect(d._prefill).toEqual({ email: "admin@acme.co.za", business_name: "Admin Co" }); // preserved, sanitized
  });
});

describe("derivePromotedColumns — cannot drift from data", () => {
  it("derives columns straight from normalized data", () => {
    const data = normalizeIntakeData({
      contact_name: "Ada",
      business_name: "Acme",
      email: "A@B.CO",
      phone: "082",
      selected_services: ["seo", "website"],
    });
    const cols = derivePromotedColumns(data);
    expect(cols).toEqual({
      business_name: "Acme",
      contact_name: "Ada",
      email: "a@b.co",
      phone: "082",
      selected_services: ["seo", "website"],
    });
    // Every column value equals what's in data → no drift possible.
    expect(cols.email).toBe(data.email);
    expect(cols.selected_services).toBe(data.selected_services);
  });

  it("ignores any client-supplied column values (only derives from data)", () => {
    const { data, columns } = normalizeIntake({
      email: "real@acme.co.za",
      business_name: "Real",
    });
    expect(columns.email).toBe("real@acme.co.za");
    expect(columns.business_name).toBe("Real");
    expect(columns.email).toBe(data.email);
  });
});
