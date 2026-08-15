import type { IntakeStatus } from "@/lib/database.types";

/** Ordered intake pipeline — the single source for labels + progression. */
export const INTAKE_STEPS: { key: IntakeStatus; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "contract_sent", label: "Contract Sent" },
  { key: "contract_signed", label: "Contract Signed" },
  { key: "invoice_sent", label: "Invoice Sent" },
  { key: "paid", label: "Invoice Paid" },
  { key: "portal_access_sent", label: "Portal Access Sent" },
  { key: "onboarding_started", label: "Onboarding Started" },
  { key: "onboarding_submitted", label: "Onboarding Submitted" },
];

export function intakeIndex(status: string): number {
  return INTAKE_STEPS.findIndex((s) => s.key === status);
}

export function intakeLabel(status: string): string {
  return INTAKE_STEPS.find((s) => s.key === status)?.label ?? status;
}

/**
 * Display order for the Intake lifecycle. Portal Access is surfaced FIRST because
 * access can now be granted while sitting with a client, before contract/invoice
 * work — so it must not read as "step 6, therefore 1–5 are done".
 */
export const INTAKE_DISPLAY_ORDER: IntakeStatus[] = [
  "portal_access_sent",
  "draft",
  "contract_sent",
  "contract_signed",
  "invoice_sent",
  "paid",
  "onboarding_started",
  "onboarding_submitted",
];

/** Independent per-step facts — each step's completion is derived from its OWN signal. */
export interface IntakeStepFacts {
  intakeStatus: string;
  contractStatus: "none" | "not_sent" | "sent" | "signed";
  hasPortalAccess: boolean;
  invoiceStatus: string | null; // from the linked deal
  paymentStatus: string | null; // from the linked deal
}

/**
 * Whether an intake step is COMPLETE, derived from its own independent fact — never
 * from the ordinal `intake_status` (which was the bug: granting Portal Access jumped
 * the ordinal and painted every earlier step green). Portal Access is independent of
 * contract/invoice; Draft completes once real pipeline work (contract/invoice/
 * onboarding) has begun — granting access alone does NOT complete Draft. The two
 * onboarding steps have no separate fact column, so they read the ordinal directly
 * (which reaching that stage genuinely represents).
 */
export function intakeStepDone(key: IntakeStatus, f: IntakeStepFacts): boolean {
  const contractSent = f.contractStatus === "sent" || f.contractStatus === "signed";
  const contractSigned = f.contractStatus === "signed";
  const invoiced = f.invoiceStatus === "invoiced" || f.paymentStatus === "paid";
  const paid = f.paymentStatus === "paid";
  const onboardingStarted = f.intakeStatus === "onboarding_started" || f.intakeStatus === "onboarding_submitted";
  const onboardingSubmitted = f.intakeStatus === "onboarding_submitted";
  switch (key) {
    case "draft":
      return contractSent || invoiced || paid || onboardingStarted; // real progress, NOT portal access
    case "contract_sent":
      return contractSent;
    case "contract_signed":
      return contractSigned;
    case "invoice_sent":
      return invoiced;
    case "paid":
      return paid;
    case "portal_access_sent":
      return f.hasPortalAccess;
    case "onboarding_started":
      return onboardingStarted;
    case "onboarding_submitted":
      return onboardingSubmitted;
    default:
      return false;
  }
}
