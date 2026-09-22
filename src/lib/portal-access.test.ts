import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  isValidEmail,
  memberAccessStatus,
  decideDefaultAfterRevoke,
} from "./portal-access";

const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";
const C = "00000000-0000-0000-0000-0000000000cc";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John@Example.COM ")).toBe("john@example.com");
  });
});

describe("isValidEmail", () => {
  it("accepts normal addresses", () => {
    expect(isValidEmail("john@example.com")).toBe(true);
    expect(isValidEmail("a.b+c@sub.domain.co.za")).toBe(true);
  });
  it("rejects malformed ones", () => {
    for (const bad of ["", "john", "john@", "@x.com", "john@x", "a b@x.com", "john@@x.com"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe("memberAccessStatus", () => {
  it("active once signed in, invited otherwise", () => {
    expect(memberAccessStatus("2026-01-01T00:00:00Z")).toBe("active");
    expect(memberAccessStatus(null)).toBe("invited");
  });
});

describe("decideDefaultAfterRevoke", () => {
  it("revoking a NON-default workspace changes nothing", () => {
    expect(
      decideDefaultAfterRevoke({ currentDefault: A, revokedClientId: B, remainingMemberships: [A] })
    ).toEqual({ newDefault: A, changed: false });
  });

  it("revoking the DEFAULT with others remaining → deterministic lowest id", () => {
    expect(
      decideDefaultAfterRevoke({ currentDefault: A, revokedClientId: A, remainingMemberships: [C, B] })
    ).toEqual({ newDefault: B, changed: true });
  });

  it("revoking the LAST membership → null default", () => {
    expect(
      decideDefaultAfterRevoke({ currentDefault: C, revokedClientId: C, remainingMemberships: [] })
    ).toEqual({ newDefault: null, changed: true });
  });

  it("is order-independent for the fallback pick", () => {
    const r1 = decideDefaultAfterRevoke({ currentDefault: A, revokedClientId: A, remainingMemberships: [B, C] });
    const r2 = decideDefaultAfterRevoke({ currentDefault: A, revokedClientId: A, remainingMemberships: [C, B] });
    expect(r1.newDefault).toBe(B);
    expect(r2.newDefault).toBe(B);
  });
});
