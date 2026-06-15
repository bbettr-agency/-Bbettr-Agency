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
