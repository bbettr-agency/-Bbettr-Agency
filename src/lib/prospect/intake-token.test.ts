import { describe, it, expect } from "vitest";
import {
  issueIntakeToken,
  hashIntakeToken,
  isWellFormedIntakeToken,
  isIntakeTokenExpired,
  INTAKE_TOKEN_TTL_DAYS,
} from "./intake-token";

describe("intake token — high-entropy, hash-only, non-enumerating", () => {
  it("issues a 43-char base64url raw token, a 64-hex hash, and an expiry", () => {
    const t = issueIntakeToken(new Date("2026-01-01T00:00:00Z"));
    expect(isWellFormedIntakeToken(t.rawToken)).toBe(true);
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.tokenHash).toBe(hashIntakeToken(t.rawToken));
    // Expiry is now + TTL.
    expect(t.expiresAt).toBe(
      new Date(Date.parse("2026-01-01T00:00:00Z") + INTAKE_TOKEN_TTL_DAYS * 86400000).toISOString()
    );
  });

  it("mints unique tokens", () => {
    const a = issueIntakeToken();
    const b = issueIntakeToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashing is deterministic and never returns the raw token", () => {
    const h = hashIntakeToken("abc");
    expect(h).toBe(hashIntakeToken("abc"));
    expect(h).not.toBe("abc");
  });

  it("rejects malformed raw tokens before any DB hit", () => {
    expect(isWellFormedIntakeToken("")).toBe(false);
    expect(isWellFormedIntakeToken("short")).toBe(false);
    expect(isWellFormedIntakeToken("a".repeat(43) + "=")).toBe(false); // 44, padded
    expect(isWellFormedIntakeToken("!".repeat(43))).toBe(false); // bad charset
    expect(isWellFormedIntakeToken(null)).toBe(false);
    expect(isWellFormedIntakeToken(123 as unknown)).toBe(false);
    expect(isWellFormedIntakeToken(issueIntakeToken().rawToken)).toBe(true);
  });

  it("expiry: not expired before, expired at/after, fail-closed on garbage", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const future = new Date(now.getTime() + 1000).toISOString();
    const past = new Date(now.getTime() - 1000).toISOString();
    expect(isIntakeTokenExpired(future, now)).toBe(false);
    expect(isIntakeTokenExpired(past, now)).toBe(true);
    expect(isIntakeTokenExpired(now.toISOString(), now)).toBe(true); // boundary = expired
    expect(isIntakeTokenExpired("not-a-date", now)).toBe(true); // fail closed
  });
});
