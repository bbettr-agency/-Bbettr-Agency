import { describe, it, expect } from "vitest";
import { intakeStepDone, INTAKE_DISPLAY_ORDER, type IntakeStepFacts } from "./intake";
import type { IntakeStatus } from "@/lib/database.types";

const facts = (o: Partial<IntakeStepFacts> = {}): IntakeStepFacts => ({
  intakeStatus: "draft",
  contractStatus: "not_sent",
  hasPortalAccess: false,
  invoiceStatus: null,
  paymentStatus: null,
  ...o,
});
const done = (f: IntakeStepFacts) => Object.fromEntries(INTAKE_DISPLAY_ORDER.map((k) => [k, intakeStepDone(k as IntakeStatus, f)]));

describe("intakeStepDone — completion from each step's OWN fact", () => {
  it("granting Portal Access to a fresh client marks ONLY Portal Access — not contract/invoice/onboarding/draft (the bug)", () => {
    // Exactly the reported scenario: intake_status jumped to portal_access_sent, access active, nothing else done.
    const d = done(facts({ intakeStatus: "portal_access_sent", hasPortalAccess: true }));
    expect(d.portal_access_sent).toBe(true);
    expect(d.draft).toBe(false);
    expect(d.contract_sent).toBe(false);
    expect(d.contract_signed).toBe(false);
    expect(d.invoice_sent).toBe(false);
    expect(d.paid).toBe(false);
    expect(d.onboarding_started).toBe(false); // granting access is NOT onboarding started
    expect(d.onboarding_submitted).toBe(false);
  });

  it("Portal Access completion is independent of the ordinal (driven by hasPortalAccess)", () => {
    expect(intakeStepDone("portal_access_sent", facts({ hasPortalAccess: true, intakeStatus: "draft" }))).toBe(true);
    expect(intakeStepDone("portal_access_sent", facts({ hasPortalAccess: false, intakeStatus: "onboarding_started" }))).toBe(false);
  });

  it("contract steps derive from contractStatus", () => {
    expect(intakeStepDone("contract_sent", facts({ contractStatus: "sent" }))).toBe(true);
    expect(intakeStepDone("contract_signed", facts({ contractStatus: "sent" }))).toBe(false);
    expect(intakeStepDone("contract_signed", facts({ contractStatus: "signed" }))).toBe(true);
    expect(intakeStepDone("contract_sent", facts({ contractStatus: "signed" }))).toBe(true); // signed ⇒ sent
  });

  it("invoice steps derive from the linked deal (paid ⇒ invoiced)", () => {
    expect(intakeStepDone("invoice_sent", facts({ invoiceStatus: "invoiced" }))).toBe(true);
    expect(intakeStepDone("paid", facts({ invoiceStatus: "invoiced" }))).toBe(false);
    expect(intakeStepDone("paid", facts({ paymentStatus: "paid" }))).toBe(true);
    expect(intakeStepDone("invoice_sent", facts({ paymentStatus: "paid" }))).toBe(true); // paid ⇒ invoiced
  });

  it("onboarding steps read the ordinal (their only fact)", () => {
    expect(intakeStepDone("onboarding_started", facts({ intakeStatus: "onboarding_started" }))).toBe(true);
    expect(intakeStepDone("onboarding_started", facts({ intakeStatus: "onboarding_submitted" }))).toBe(true);
    expect(intakeStepDone("onboarding_submitted", facts({ intakeStatus: "onboarding_started" }))).toBe(false);
    expect(intakeStepDone("onboarding_submitted", facts({ intakeStatus: "onboarding_submitted" }))).toBe(true);
  });

  it("Draft completes on real pipeline progress — NOT on portal access alone", () => {
    expect(intakeStepDone("draft", facts({ hasPortalAccess: true }))).toBe(false); // portal only → draft not done
    expect(intakeStepDone("draft", facts({ contractStatus: "sent" }))).toBe(true);
    expect(intakeStepDone("draft", facts({ paymentStatus: "paid" }))).toBe(true);
    expect(intakeStepDone("draft", facts({ intakeStatus: "onboarding_started" }))).toBe(true);
  });

  it("Portal Access is displayed first in the lifecycle", () => {
    expect(INTAKE_DISPLAY_ORDER[0]).toBe("portal_access_sent");
    expect(INTAKE_DISPLAY_ORDER).toHaveLength(8);
  });
});
