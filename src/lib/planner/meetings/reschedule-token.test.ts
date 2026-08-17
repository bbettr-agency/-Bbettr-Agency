import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  issueRescheduleToken,
  hashRescheduleToken,
  isWellFormedRawToken,
  RESCHEDULE_TOKEN_TTL_DAYS,
} from "./reschedule-token";

describe("reschedule token", () => {
  it("mints a base64url 32-byte token whose RAW value is never the stored value", () => {
    const t = issueRescheduleToken();
    expect(isWellFormedRawToken(t.rawToken)).toBe(true);
    expect(t.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url, no padding
    // The persisted value is the HASH, never the raw token.
    expect(t.tokenHash).not.toEqual(t.rawToken);
    expect(t.tokenHash).toHaveLength(64);
  });

  it("hash is deterministic SHA-256 hex of the raw token", () => {
    const t = issueRescheduleToken();
    expect(hashRescheduleToken(t.rawToken)).toBe(t.tokenHash);
    expect(hashRescheduleToken(t.rawToken)).toBe(hashRescheduleToken(t.rawToken));
    expect(t.tokenHash).toBe(createHash("sha256").update(t.rawToken).digest("hex"));
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokens are unique across issuances", () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueRescheduleToken().rawToken));
    expect(seen.size).toBe(200);
  });

  it("expiry is exactly 14 days from now", () => {
    const now = new Date("2026-08-17T09:00:00Z");
    const t = issueRescheduleToken(now);
    const expected = new Date(now.getTime() + RESCHEDULE_TOKEN_TTL_DAYS * 86400_000).toISOString();
    expect(t.expiresAt).toBe(expected);
    expect(RESCHEDULE_TOKEN_TTL_DAYS).toBe(14);
  });

  it("rejects malformed / wrong-length / non-string tokens", () => {
    expect(isWellFormedRawToken("")).toBe(false);
    expect(isWellFormedRawToken("too-short")).toBe(false);
    expect(isWellFormedRawToken("a".repeat(43) + "=")).toBe(false); // padding not allowed
    expect(isWellFormedRawToken("a".repeat(64))).toBe(false); // hash-length ≠ raw
    expect(isWellFormedRawToken("has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isWellFormedRawToken(null)).toBe(false);
    expect(isWellFormedRawToken(undefined)).toBe(false);
    expect(isWellFormedRawToken(12345)).toBe(false);
  });
});
