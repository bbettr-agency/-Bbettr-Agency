import { describe, it, expect } from "vitest";
import {
  validateBillingDraft,
  resolveEffectiveEmail,
  isBillingComplete,
  normaliseBillingInput,
  toBillingInput,
  toBillingView,
  EMPTY_BILLING_INPUT,
  BILLING_LIMITS,
  type BillingDetailsInput,
  type BillingDetailsView,
} from "./billing-details";
import type { ClientBillingDetails } from "@/lib/database.types";

const input = (over: Partial<BillingDetailsInput> = {}): BillingDetailsInput => ({
  ...EMPTY_BILLING_INPUT,
  ...over,
});

describe("validateBillingDraft (PARTIAL saves allowed)", () => {
  it("allows a completely empty draft", () => {
    expect(validateBillingDraft(input()).ok).toBe(true);
  });
  it("allows an invoice_name-only draft (no email)", () => {
    expect(validateBillingDraft(input({ invoice_name: "Acme" })).ok).toBe(true);
  });
  it("allows a VAT + address only draft (no invoice_name / no email)", () => {
    expect(validateBillingDraft(input({ vat_number: "4123456789", billing_address: "1 Main Rd" })).ok).toBe(true);
  });
  it("allows company registration only", () => {
    expect(validateBillingDraft(input({ company_registration_number: "2015/123456/07" })).ok).toBe(true);
  });
  it("allows same-as-contact with no contact email at DRAFT stage (completeness is separate)", () => {
    expect(validateBillingDraft(input({ billing_email_same_as_contact: true })).ok).toBe(true);
  });
  it("REJECTS a malformed explicit billing email", () => {
    const v = validateBillingDraft(input({ billing_email: "not-an-email" }));
    expect(v.ok).toBe(false);
    expect(v.errors.billing_email).toMatch(/valid billing email/i);
  });
  it("does NOT check billing_email format when same-as-contact (it's dropped)", () => {
    expect(validateBillingDraft(input({ billing_email: "junk", billing_email_same_as_contact: true })).ok).toBe(true);
  });
  it("REJECTS over-length supplied fields (mirrors 0055 limits)", () => {
    expect(validateBillingDraft(input({ invoice_name: "x".repeat(BILLING_LIMITS.invoice_name + 1) })).errors.invoice_name).toBeTruthy();
    expect(validateBillingDraft(input({ vat_number: "9".repeat(BILLING_LIMITS.vat_number + 1) })).errors.vat_number).toBeTruthy();
  });
  it("accepts a valid explicit billing email", () => {
    expect(validateBillingDraft(input({ invoice_name: "Acme (Pty) Ltd", billing_email: "accounts@acme.co.za" })).ok).toBe(true);
  });
});

describe("resolveEffectiveEmail", () => {
  it("uses the contact email when same-as-contact", () => {
    expect(resolveEffectiveEmail({ billingEmailSameAsContact: true, billingEmail: null }, "c@x.com")).toBe("c@x.com");
  });
  it("is null when same-as-contact but no valid contact email", () => {
    expect(resolveEffectiveEmail({ billingEmailSameAsContact: true, billingEmail: "b@x.com" }, null)).toBeNull();
  });
  it("uses the explicit billing email otherwise", () => {
    expect(resolveEffectiveEmail({ billingEmailSameAsContact: false, billingEmail: "b@x.com" }, "c@x.com")).toBe("b@x.com");
  });
});

describe("isBillingComplete", () => {
  const view = (over: Partial<BillingDetailsView> = {}): BillingDetailsView => ({
    invoiceName: "Acme", billingEmail: "a@b.com", billingEmailSameAsContact: false,
    companyRegistrationNumber: null, vatNumber: null, billingContactName: null,
    billingAddress: null, poReference: null, invoiceInstructions: null, updatedAt: null, ...over,
  });
  it("null view is incomplete", () => expect(isBillingComplete(null, "c@x.com")).toBe(false));
  it("missing invoice name is incomplete", () => expect(isBillingComplete(view({ invoiceName: null }), "c@x.com")).toBe(false));
  it("explicit email complete", () => expect(isBillingComplete(view(), null)).toBe(true));
  it("same-as-contact complete only with a valid contact email", () => {
    expect(isBillingComplete(view({ billingEmailSameAsContact: true, billingEmail: null }), "c@x.com")).toBe(true);
    expect(isBillingComplete(view({ billingEmailSameAsContact: true, billingEmail: null }), null)).toBe(false);
  });
});

describe("normaliseBillingInput", () => {
  it("drops billing_email to NULL when same-as-contact (no stale duplication)", () => {
    const n = normaliseBillingInput(input({ invoice_name: " Acme ", billing_email: "stale@x.com", billing_email_same_as_contact: true }));
    expect(n.billing_email).toBeNull();
    expect(n.billing_email_same_as_contact).toBe(true);
    expect(n.invoice_name).toBe("Acme"); // trimmed
  });
  it("keeps the explicit billing email when not same-as-contact; blanks → null", () => {
    const n = normaliseBillingInput(input({ invoice_name: "Acme", billing_email: " a@b.com ", vat_number: "   " }));
    expect(n.billing_email).toBe("a@b.com");
    expect(n.vat_number).toBeNull();
  });
});

describe("view/input round-trips", () => {
  it("toBillingView whitelists row fields; toBillingInput fills blanks", () => {
    const row = { invoice_name: "Acme", billing_email_same_as_contact: true, billing_email: null, vat_number: "123" } as ClientBillingDetails;
    const view = toBillingView(row)!;
    expect(view.invoiceName).toBe("Acme");
    expect(view.vatNumber).toBe("123");
    expect(toBillingInput(view).invoice_name).toBe("Acme");
    expect(toBillingInput(null)).toEqual(EMPTY_BILLING_INPUT);
  });
});
