import { describe, it, expect } from "vitest";
import {
  isTerminalStatus,
  canTransition,
  canDismiss,
  tokenCapability,
  canSubmit,
  canConvert,
  isAlreadyConverted,
  normalizeServiceSelection,
  isSubmittableSelection,
  isValidService,
  PROSPECT_INTAKE_STATUSES,
} from "./intake-lifecycle";

describe("lifecycle transitions", () => {
  it("draft can go to submitted, converted, or dismissed", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("draft", "converted")).toBe(true);
    expect(canTransition("draft", "dismissed")).toBe(true);
  });
  it("submitted can go to converted or dismissed, not back to draft", () => {
    expect(canTransition("submitted", "converted")).toBe(true);
    expect(canTransition("submitted", "dismissed")).toBe(true);
    expect(canTransition("submitted", "draft")).toBe(false);
  });
  it("converted and dismissed are terminal", () => {
    expect(isTerminalStatus("converted")).toBe(true);
    expect(isTerminalStatus("dismissed")).toBe(true);
    for (const to of PROSPECT_INTAKE_STATUSES) {
      expect(canTransition("converted", to)).toBe(false);
      expect(canTransition("dismissed", to)).toBe(false);
    }
  });
  it("draft/submitted are not terminal", () => {
    expect(isTerminalStatus("draft")).toBe(false);
    expect(isTerminalStatus("submitted")).toBe(false);
  });
});

describe("token capability by state + expiry (invalidation semantics)", () => {
  it("live draft is readable AND mutable (resumable)", () => {
    expect(tokenCapability("draft", false)).toEqual({ canRead: true, canMutate: true });
  });
  it("live submitted is readable but NOT mutable (no silent edits)", () => {
    expect(tokenCapability("submitted", false)).toEqual({ canRead: true, canMutate: false });
  });
  it("converted and dismissed permit nothing", () => {
    expect(tokenCapability("converted", false)).toEqual({ canRead: false, canMutate: false });
    expect(tokenCapability("dismissed", false)).toEqual({ canRead: false, canMutate: false });
  });
  it("expired permits nothing, even for a draft/submitted", () => {
    expect(tokenCapability("draft", true)).toEqual({ canRead: false, canMutate: false });
    expect(tokenCapability("submitted", true)).toEqual({ canRead: false, canMutate: false });
  });
});

describe("submission rules", () => {
  it("only a live draft can be submitted", () => {
    expect(canSubmit("draft", false)).toBe(true);
    expect(canSubmit("draft", true)).toBe(false); // expired
    expect(canSubmit("submitted", false)).toBe(false);
    expect(canSubmit("converted", false)).toBe(false);
    expect(canSubmit("dismissed", false)).toBe(false);
  });
});

describe("conversion idempotency primitives", () => {
  it("convertible from draft/submitted only when not already converted", () => {
    expect(canConvert({ status: "draft", convertedClientId: null })).toBe(true);
    expect(canConvert({ status: "submitted", convertedClientId: null })).toBe(true);
    expect(canConvert({ status: "converted", convertedClientId: "c1" })).toBe(false);
    expect(canConvert({ status: "dismissed", convertedClientId: null })).toBe(false);
  });
  it("a prospect that already produced a client can NEVER convert again", () => {
    // Even if status somehow reads draft, a set converted_client_id blocks it.
    expect(canConvert({ status: "draft", convertedClientId: "c1" })).toBe(false);
    expect(isAlreadyConverted({ status: "draft", convertedClientId: "c1" })).toBe(true);
    expect(isAlreadyConverted({ status: "converted", convertedClientId: null })).toBe(true);
    expect(isAlreadyConverted({ status: "submitted", convertedClientId: null })).toBe(false);
  });
});

describe("service selection", () => {
  it("accepts only the four catalog services", () => {
    for (const s of ["website", "google_ads", "meta_ads", "seo"]) expect(isValidService(s)).toBe(true);
    expect(isValidService("email")).toBe(false);
    expect(isValidService("")).toBe(false);
  });
  it("normalises: dedupes and drops unknowns, preserving order", () => {
    expect(normalizeServiceSelection(["seo", "seo", "bogus", "website"])).toEqual(["seo", "website"]);
    expect(normalizeServiceSelection([])).toEqual([]);
  });
  it("submittable selection is non-empty and entirely valid (no unknowns)", () => {
    expect(isSubmittableSelection(["website", "seo"])).toBe(true);
    expect(isSubmittableSelection([])).toBe(false); // must pick at least one
    expect(isSubmittableSelection(["website", "bogus"])).toBe(false); // contains unknown
    expect(isSubmittableSelection(["seo", "seo"])).toBe(false); // duplicate ⇒ not clean
  });
});

describe("canDismiss — admin triage rule (submitted only), delegating to canTransition", () => {
  it("allows dismissing ONLY a submitted intake", () => {
    expect(canDismiss("submitted")).toBe(true);
  });
  it("never allows dismissing draft, converted, or dismissed via this rule", () => {
    expect(canDismiss("draft")).toBe(false); // drafts are not surfaced as leads
    expect(canDismiss("converted")).toBe(false);
    expect(canDismiss("dismissed")).toBe(false);
  });
  it("stays consistent with the canonical transition (never exceeds it)", () => {
    for (const s of PROSPECT_INTAKE_STATUSES) {
      if (canDismiss(s)) expect(canTransition(s, "dismissed")).toBe(true);
    }
  });
});
