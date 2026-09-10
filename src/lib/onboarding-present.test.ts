import { describe, it, expect } from "vitest";
import { presentOnboarding, type PresentedSection, type PresentedRow } from "./onboarding-present";

function section(secs: PresentedSection[], title: string) {
  return secs.find((s) => s.title === title);
}
function row(sec: PresentedSection | undefined, label: string): PresentedRow | undefined {
  return sec?.rows.find((r) => r.label === label);
}

const WEBSITE = {
  business_name: "A&S Wholesalers",
  business_description: "We distribute Haier airconditioning", // textarea → longtext
  services: "All your Haier air-conditioning needs",
  unique_selling_points: "", // empty → dropped
  primary_cta: "Send Enquiry", // select → text
  existing_website_url: "answholesalers.co.za", // url
  target_locations: ["Pretoria", "Gauteng"], // multitext → list
  required_pages: ["Home", "About", "Contact"], // checkbox-group → list
  team_members: [{ name: "Ada", position: "Owner" }], // group-list
  domain_exists: "No", // boolean
  contact_email: "haier@answholesalers.co.za", // email
  contact_phone: "012 323 2101", // tel
  whatsapp_number: "065 815 1032", // tel
  payment_methods: ["PayFast"], // hidden: needs required_pages ⊇ "Shop / E-commerce"
  legacy_note: "kept from an older form", // unknown key → Additional details
};

describe("presentOnboarding — website (schema-driven, human brief)", () => {
  const { sections, hasContent } = presentOnboarding("website", WEBSITE);
  it("has content and orders sections by the schema", () => {
    expect(hasContent).toBe(true);
    const titles = sections.map((s) => s.title);
    expect(titles[0]).toBe("Business Information");
    expect(titles).toContain("Contact Information");
    expect(titles[titles.length - 1]).toBe("Additional details"); // legacy keys last
  });

  it("uses human labels, never uppercased raw keys", () => {
    const biz = section(sections, "Business Information");
    expect(row(biz, "Business Name")?.text).toBe("A&S Wholesalers");
    expect(row(biz, "Primary Call To Action")?.text).toBe("Send Enquiry");
    // The raw key label ("business_name" / "BUSINESS NAME") must not appear.
    expect(sections.flatMap((s) => s.rows).some((r) => /_/.test(r.label))).toBe(false);
    expect(sections.flatMap((s) => s.rows).some((r) => r.label === r.label.toUpperCase() && r.label.length > 3)).toBe(false);
  });

  it("classifies value kinds correctly", () => {
    const biz = section(sections, "Business Information");
    expect(row(biz, "Business Description")?.kind).toBe("longtext");
    expect(row(biz, "Business Description")?.full).toBe(true);
    expect(row(biz, "Existing Website URL")?.kind).toBe("url");
    expect(row(biz, "Target Locations")).toMatchObject({ kind: "list", items: ["Pretoria", "Gauteng"] });

    const contact = section(sections, "Contact Information");
    expect(row(contact, "Contact Email")?.kind).toBe("email");
    expect(row(contact, "Contact Phone")?.kind).toBe("tel");
    expect(row(contact, "WhatsApp Number")?.kind).toBe("tel");

    const tech = section(sections, "Technical Access");
    expect(row(tech, "Do You Already Have a Domain?")).toMatchObject({ kind: "text", text: "No" }); // boolean → Yes/No
  });

  it("renders checkbox lists and group-list entries cleanly (no JSON)", () => {
    const content = section(sections, "Website Content");
    expect(row(content, "Required Pages")).toMatchObject({ kind: "list", items: ["Home", "About", "Contact"] });
    const team = row(content, "Team Information");
    expect(team?.kind).toBe("group");
    expect(team?.entries?.[0].map((r) => [r.label, r.text])).toEqual([
      ["Team Member Name", "Ada"],
      ["Position", "Owner"],
    ]);
  });

  it("drops empty answers and honours visibleWhen (payment methods hidden)", () => {
    const biz = section(sections, "Business Information");
    expect(row(biz, "Unique Selling Points")).toBeUndefined(); // empty
    // payment_methods requires a Shop / E-commerce page → not selected → hidden.
    expect(sections.flatMap((s) => s.rows).some((r) => r.label === "Payment Methods")).toBe(false);
  });

  it("preserves unknown/legacy keys under 'Additional details' without raw JSON", () => {
    const extra = section(sections, "Additional details");
    expect(row(extra, "Legacy Note")?.text).toBe("kept from an older form");
    // Nothing anywhere is a stringified object.
    expect(JSON.stringify(sections)).not.toContain("[object Object]");
  });
});

describe("presentOnboarding — reusable across services + edge cases", () => {
  it("shows payment methods once a Shop / E-commerce page is selected (visibleWhen satisfied)", () => {
    const { sections } = presentOnboarding("website", {
      ...WEBSITE,
      required_pages: ["Home", "Shop / E-commerce"],
    });
    expect(sections.flatMap((s) => s.rows).some((r) => r.label === "Payment Methods")).toBe(true);
  });

  it("renders an actual boolean true as 'Yes'", () => {
    const { sections } = presentOnboarding("website", { currently_running_ads: true });
    const r = sections.flatMap((s) => s.rows).find((x) => x.label === "Currently Running Ads?");
    expect(r).toMatchObject({ kind: "text", text: "Yes" });
  });

  it("is schema-driven for every service (google_ads/meta_ads/seo don't throw and stay empty for empty data)", () => {
    for (const svc of ["google_ads", "meta_ads", "seo"] as const) {
      expect(presentOnboarding(svc, {})).toEqual({ sections: [], hasContent: false });
    }
  });

  it("empty / missing data → no content, no sections", () => {
    expect(presentOnboarding("seo", {})).toEqual({ sections: [], hasContent: false });
    expect(presentOnboarding("website", null).hasContent).toBe(false);
  });
});
