import { describe, it, expect } from "vitest";
import {
  validateBillingInput,
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

describe("validateBillingInput", () => {
  it("requires invoice_name", () => {
    const v = validateBillingInput(input({ billing_email: "a@b.com" }), null);
    expect(v.ok).toBe(false);
    expect(v.errors.invoice_name).toBeTruthy();
  });

  it("accepts a complete profile with a valid explicit billing email", () => {
    const v = validateBillingInput(input({ invoice_name: "Acme (Pty) Ltd", billing_email: "accounts@acme.co.za" }), null);
    expect(v.ok).toBe(true);
  });

  it("rejects an invalid explicit billing email", () => {
    const v = validateBillingInput(input({ invoice_name: "Acme", billing_email: "not-an-email" }), null);
    expect(v.ok).toBe(false);
    expect(v.errors.billing_email).toMatch(/valid billing email/i);
  });

  it("requires a billing email when not same-as-contact and none given", () => {
    const v = validateBillingInput(input({ invoice_name: "Acme" }), "contact@acme.com");
    expect(v.ok).toBe(false);
    expect(v.errors.billing_email).toMatch(/required/i);
  });

  it("same-as-contact is complete when the account email is valid", () => {
    const v = validateBillingInput(input({ invoice_name: "Acme", billing_email_same_as_contact: true }), "contact@acme.com");
    expect(v.ok).toBe(true);
  });

  it("same-as-contact is REJECTED when the account email is missing/invalid", () => {
    expect(validateBillingInput(input({ invoice_name: "Acme", billing_email_same_as_contact: true }), null).ok).toBe(false);
    expect(validateBillingInput(input({ invoice_name: "Acme", billing_email_same_as_contact: true }), "bad").ok).toBe(false);
  });

  it("optional fields are genuinely optional", () => {
    const v = validateBillingInput(input({ invoice_name: "Acme", billing_email: "a@b.com" }), null);
    expect(v.ok).toBe(true); // reg/vat/contact/address/po/instructions all blank
  });

  it("enforces the same length limits as the DB (0055)", () => {
    const v = validateBillingInput(
      input({ invoice_name: "x".repeat(BILLING_LIMITS.invoice_name + 1), billing_email: "a@b.com" }),
      null
    );
    expect(v.ok).toBe(false);
    expect(v.errors.invoice_name).toMatch(/characters or fewer/i);
    expect(validateBillingInput(input({ invoice_name: "Acme", billing_email: "a@b.com", vat_number: "9".repeat(BILLING_LIMITS.vat_number + 1) }), null).errors.vat_number).toBeTruthy();
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
