import { describe, it, expect } from "vitest";
import { renderOnboardingPdf } from "./onboarding-pdf-render";
import { buildOnboardingPdfModel } from "./onboarding-pdf";

const pdfHeader = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString("latin1");

describe("renderOnboardingPdf — real PDF output (Node runtime, like Vercel)", () => {
  it("renders a valid, non-trivial %PDF for a rich submission", async () => {
    const model = buildOnboardingPdfModel({
      service: "website",
      data: {
        business_name: "A&S Wholesalers",
        business_description: "We distribute Haier airconditioning across Gauteng.\nSecond line.",
        primary_cta: "Send Enquiry",
        existing_website_url: "answholesalers.co.za",
        contact_email: "haier@answholesalers.co.za",
        contact_phone: "012 323 2101",
        required_pages: ["Home", "About", "Services", "Portfolio / Gallery", "Contact"],
        team_members: [{ name: "Ada", position: "Owner" }],
        domain_exists: "No",
        legacy_field: "kept from an older form",
      },
      businessName: "A&S Wholesalers",
      status: "in_progress", // filled draft — must still render
      submittedAt: "2026-09-08T10:00:00Z",
    });
    const bytes = await renderOnboardingPdf(model);
    expect(pdfHeader(bytes)).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("renders an empty submission without throwing", async () => {
    const model = buildOnboardingPdfModel({
      service: "seo",
      data: {},
      businessName: "",
      status: "approved",
      submittedAt: null,
    });
    const bytes = await renderOnboardingPdf(model);
    expect(pdfHeader(bytes)).toBe("%PDF-");
  });

  it("never throws on un-encodable / smart-punctuation / very long input (WinAnsi-safe)", async () => {
    const model = buildOnboardingPdfModel({
      service: "website",
      data: {
        business_name: "Café Über — “Smart” quotes… 日本語 🚀 ✅",
        business_description: "x".repeat(400) + " 联系我们 " + "https://" + "a".repeat(300) + ".com",
        contact_email: "info@café.co.za",
      },
      businessName: "Café Über 🚀",
      status: "submitted",
      submittedAt: "not-a-real-date",
    });
    const bytes = await renderOnboardingPdf(model);
    expect(pdfHeader(bytes)).toBe("%PDF-");
  });
});
