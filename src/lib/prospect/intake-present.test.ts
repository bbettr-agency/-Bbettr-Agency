import { describe, it, expect } from "vitest";
import { presentIntake, serviceLabelsFor, type IntakeRowLike } from "./intake-present";

function row(overrides: Partial<IntakeRowLike> = {}): IntakeRowLike {
  return {
    status: "submitted",
    source: "generic",
    business_name: "Acme Plumbing",
    contact_name: "Ada Lovelace",
    email: "ada@acme.co.za",
    phone: "082 000 0000",
    selected_services: ["website", "seo"],
    submitted_at: "2026-09-08T10:00:00Z",
    data: {
      business_name: "Acme Plumbing",
      contact_name: "Ada Lovelace",
      email: "ada@acme.co.za",
      phone: "082 000 0000",
      location: "Cape Town",
      existing_website_url: "https://acme.co.za",
      selected_services: ["website", "seo"],
      services_uncertain: false,
      website_goal_primary: "Get leads",
      keywords: ["emergency plumber", "geyser repair"],
      goals: ["More leads", "Grow local visibility"],
      goals_note: "Mostly want the phone ringing.",
      investment_band: "R5,000 – R15,000",
      readiness: "Within the next month",
      _prefill: { email: "old@acme.co.za" }, // reserved — must never surface
    },
    ...overrides,
  };
}

describe("presentIntake — header", () => {
  it("surfaces the key contact/business facts and service labels", () => {
    const { header } = presentIntake(row());
    expect(header.business).toBe("Acme Plumbing");
    expect(header.contact).toBe("Ada Lovelace");
    expect(header.email).toBe("ada@acme.co.za");
    expect(header.phone).toBe("082 000 0000");
    expect(header.location).toBe("Cape Town");
    expect(header.website).toBe("https://acme.co.za");
    expect(header.services).toEqual(["Website Design", "SEO"]);
    expect(header.uncertain).toBe(false);
    expect(header.submittedAt).toBe("2026-09-08T10:00:00Z");
    expect(header.status).toBe("submitted");
  });

  it("falls back to promoted columns when data lacks the field", () => {
    const { header } = presentIntake(
      row({ data: { selected_services: ["website"] }, business_name: "ColBiz", contact_name: "Col" })
    );
    expect(header.business).toBe("ColBiz");
    expect(header.contact).toBe("Col");
  });
});

describe("presentIntake — sections (labelled, no raw JSON, no reserved keys)", () => {
  it("builds per-service detail + goals + budget sections in order", () => {
    const { sections } = presentIntake(row());
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual([
      "What they want help with",
      "Website Design details",
      "SEO details",
      "Goals",
      "Budget & timing",
    ]);

    const website = sections.find((s) => s.title === "Website Design details")!;
    expect(website.rows).toContainEqual({ label: "What's the main job of the new site?", value: "Get leads" });

    const seo = sections.find((s) => s.title === "SEO details")!;
    expect(seo.rows[0].value).toBe("emergency plumber, geyser repair");

    const goals = sections.find((s) => s.title === "Goals")!;
    expect(goals.rows.find((r) => r.value === "More leads, Grow local visibility")).toBeTruthy();

    const budget = sections.find((s) => s.title === "Budget & timing")!;
    expect(budget.rows.map((r) => r.value)).toEqual(["R5,000 – R15,000", "Within the next month"]);
  });

  it("never surfaces reserved (_-prefixed) keys or raw field names", () => {
    const json = JSON.stringify(presentIntake(row()));
    expect(json).not.toContain("_prefill");
    expect(json).not.toContain("old@acme.co.za");
  });

  it("'not sure yet' shows a guidance row and skips service details", () => {
    const { header, sections } = presentIntake(
      row({
        selected_services: [],
        data: { services_uncertain: true, goals: ["More leads"] },
      })
    );
    expect(header.uncertain).toBe(true);
    expect(header.services).toEqual([]);
    const help = sections.find((s) => s.title === "What they want help with")!;
    expect(help.rows[0].value).toContain("Not sure yet");
    expect(sections.some((s) => s.title.endsWith("details"))).toBe(false);
  });

  it("empty optional answers are omitted, and unknown services are ignored", () => {
    const { header, sections } = presentIntake(
      row({
        selected_services: ["website", "bogus-service"],
        data: { selected_services: ["website", "bogus-service"] }, // no answers filled
      })
    );
    expect(header.services).toEqual(["Website Design"]); // bogus filtered out
    // With no answers, only the services-summary section exists.
    expect(sections.map((s) => s.title)).toEqual(["What they want help with"]);
  });
});

describe("serviceLabelsFor", () => {
  it("maps + orders catalog services and drops unknowns", () => {
    expect(serviceLabelsFor(["seo", "website", "nope"])).toEqual(["SEO", "Website Design"]);
    expect(serviceLabelsFor(null)).toEqual([]);
  });
});
