import type { ClientBillingDetails } from "@/lib/database.types";

/**
 * Client billing-details domain — PURE (no I/O, no server-only), so both the
 * client form (live validation) and the server actions (authoritative
 * validation + the onboarding submit gate) share ONE source of truth. Billing is
 * CLIENT-LEVEL: one profile per client, shared across every service.
 */

/** Modest length limits — MUST mirror the CHECKs in migration 0055. */
export const BILLING_LIMITS = {
  invoice_name: 200,
  company_registration_number: 50,
  vat_number: 30,
  billing_email: 254,
  billing_contact_name: 200,
  billing_address: 1000,
  po_reference: 120,
  invoice_instructions: 2000,
} as const;

// Pragmatic real-world email shape (same as the meetings validator). No
// SA-specific VAT/registration regex — those stay free-form.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (v: string): boolean => EMAIL_RE.test(v.trim());

/** Form/DTO shape the UI edits and the actions accept. */
export interface BillingDetailsInput {
  invoice_name: string;
  company_registration_number: string;
  vat_number: string;
  billing_email: string;
  billing_email_same_as_contact: boolean;
  billing_contact_name: string;
  billing_address: string;
  po_reference: string;
  invoice_instructions: string;
}

/** Whitelisted read shape exposed to the UI (never a raw row with extra cols). */
export interface BillingDetailsView {
  invoiceName: string | null;
  companyRegistrationNumber: string | null;
  vatNumber: string | null;
  billingEmail: string | null;
  billingEmailSameAsContact: boolean;
  billingContactName: string | null;
  billingAddress: string | null;
  poReference: string | null;
  invoiceInstructions: string | null;
  updatedAt: string | null;
}

export const EMPTY_BILLING_INPUT: BillingDetailsInput = {
  invoice_name: "",
  company_registration_number: "",
  vat_number: "",
  billing_email: "",
  billing_email_same_as_contact: false,
  billing_contact_name: "",
  billing_address: "",
  po_reference: "",
  invoice_instructions: "",
};

/** Row → whitelisted view. */
export function toBillingView(row: ClientBillingDetails | null): BillingDetailsView | null {
  if (!row) return null;
  return {
    invoiceName: row.invoice_name,
    companyRegistrationNumber: row.company_registration_number,
    vatNumber: row.vat_number,
    billingEmail: row.billing_email,
    billingEmailSameAsContact: row.billing_email_same_as_contact,
    billingContactName: row.billing_contact_name,
    billingAddress: row.billing_address,
    poReference: row.po_reference,
    invoiceInstructions: row.invoice_instructions,
    updatedAt: row.updated_at,
  };
}

/** View → editable form input (empty strings for nulls). */
export function toBillingInput(view: BillingDetailsView | null): BillingDetailsInput {
  if (!view) return { ...EMPTY_BILLING_INPUT };
  return {
    invoice_name: view.invoiceName ?? "",
    company_registration_number: view.companyRegistrationNumber ?? "",
    vat_number: view.vatNumber ?? "",
    billing_email: view.billingEmail ?? "",
    billing_email_same_as_contact: view.billingEmailSameAsContact,
    billing_contact_name: view.billingContactName ?? "",
    billing_address: view.billingAddress ?? "",
    po_reference: view.poReference ?? "",
    invoice_instructions: view.invoiceInstructions ?? "",
  };
}

const trimOrNull = (v: string): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Normalise input to the persisted column shape. When "same as contact" is on,
 * billing_email is deliberately dropped to NULL (no duplication/drift — the
 * effective email resolves from clients.contact_email at read time).
 */
export function normaliseBillingInput(
  input: BillingDetailsInput
): Omit<ClientBillingDetails, "client_id" | "created_at" | "updated_at" | "updated_by"> {
  const sameAsContact = Boolean(input.billing_email_same_as_contact);
  return {
    invoice_name: trimOrNull(input.invoice_name),
    company_registration_number: trimOrNull(input.company_registration_number),
    vat_number: trimOrNull(input.vat_number),
    billing_email: sameAsContact ? null : trimOrNull(input.billing_email),
    billing_email_same_as_contact: sameAsContact,
    billing_contact_name: trimOrNull(input.billing_contact_name),
    billing_address: trimOrNull(input.billing_address),
    po_reference: trimOrNull(input.po_reference),
    invoice_instructions: trimOrNull(input.invoice_instructions),
  };
}

/**
 * The effective billing email: the client's contact_email when "same as
 * contact", else the explicit billing_email. Null when neither is available.
 */
export function resolveEffectiveEmail(
  opts: { billingEmailSameAsContact: boolean; billingEmail: string | null },
  contactEmail: string | null
): string | null {
  if (opts.billingEmailSameAsContact) {
    return contactEmail && isValidEmail(contactEmail) ? contactEmail.trim() : null;
  }
  return opts.billingEmail && isValidEmail(opts.billingEmail) ? opts.billingEmail.trim() : null;
}

export interface BillingValidation {
  ok: boolean;
  /** Field-keyed messages for the form. */
  errors: Partial<Record<keyof BillingDetailsInput, string>>;
}

/**
 * Authoritative validation for a COMPLETE billing profile. Required:
 * invoice_name + an effective billing email (same-as-contact with a valid
 * contact_email, OR a valid explicit billing_email). Everything else optional.
 * Also enforces the 0055 length limits.
 */
export function validateBillingInput(
  input: BillingDetailsInput,
  contactEmail: string | null
): BillingValidation {
  const errors: BillingValidation["errors"] = {};

  if (!trimOrNull(input.invoice_name)) {
    errors.invoice_name = "Invoice / company name is required.";
  }

  if (input.billing_email_same_as_contact) {
    if (!contactEmail || !isValidEmail(contactEmail)) {
      errors.billing_email =
        "Your account email isn't available or valid — please enter a billing email instead.";
    }
  } else {
    const email = trimOrNull(input.billing_email);
    if (!email) errors.billing_email = "A billing email is required.";
    else if (!isValidEmail(email)) errors.billing_email = "Enter a valid billing email.";
  }

  // Length guards (mirror 0055) on the trimmed values.
  (Object.keys(BILLING_LIMITS) as (keyof typeof BILLING_LIMITS)[]).forEach((k) => {
    const v = trimOrNull(input[k] as string);
    if (v && v.length > BILLING_LIMITS[k]) {
      errors[k] = `Must be ${BILLING_LIMITS[k]} characters or fewer.`;
    }
  });

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Is the stored billing profile COMPLETE enough to allow an onboarding submit?
 * (invoice_name present + a resolvable effective email.) Used by the shared
 * onboarding submit gate.
 */
export function isBillingComplete(
  view: BillingDetailsView | null,
  contactEmail: string | null
): boolean {
  if (!view) return false;
  if (!view.invoiceName || view.invoiceName.trim().length === 0) return false;
  return (
    resolveEffectiveEmail(
      { billingEmailSameAsContact: view.billingEmailSameAsContact, billingEmail: view.billingEmail },
      contactEmail
    ) !== null
  );
}
