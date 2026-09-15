import { describe, it, expect } from "vitest";
import { parseRecoveryParams } from "./auth-recovery";

const p = (obj: Record<string, string>) => new URLSearchParams(obj);

describe("parseRecoveryParams", () => {
  it("token_hash + type=recovery → verifyOtp plan (device-independent)", () => {
    expect(parseRecoveryParams(p({ token_hash: "abc", type: "recovery", next: "/reset-password" }))).toEqual({
      mode: "otp",
      tokenHash: "abc",
      type: "recovery",
      next: "/reset-password",
    });
  });

  it("code (no token_hash) → exchangeCodeForSession plan (same-browser fallback)", () => {
    expect(parseRecoveryParams(p({ code: "xyz", next: "/reset-password" }))).toEqual({
      mode: "code",
      code: "xyz",
      next: "/reset-password",
    });
  });

  it("missing token/code → invalid (so we show a friendly state, not a vague failure)", () => {
    expect(parseRecoveryParams(p({ next: "/reset-password" }))).toMatchObject({
      mode: "invalid",
      reason: "missing_token",
    });
  });

  it("rejects an unknown otp type", () => {
    expect(parseRecoveryParams(p({ token_hash: "abc", type: "totp" }))).toMatchObject({
      mode: "invalid",
      reason: "bad_type",
    });
  });

  it("sanitises next against open redirects", () => {
    expect(parseRecoveryParams(p({ code: "c", next: "https://evil.com" })).next).toBe("/reset-password");
    expect(parseRecoveryParams(p({ code: "c", next: "//evil" })).next).toBe("/reset-password");
    expect(parseRecoveryParams(p({ code: "c" })).next).toBe("/reset-password");
    expect(parseRecoveryParams(p({ code: "c", next: "/dashboard" })).next).toBe("/dashboard");
  });
});
