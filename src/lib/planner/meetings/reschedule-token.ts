import "server-only";
import { randomBytes, createHash } from "node:crypto";

/**
 * Secure self-service reschedule token (Slice D, contract from migration 0053).
 *
 * The RAW token is the client's authorization: it exists ONLY in the emailed
 * `/reschedule/<raw>` URL and is never persisted. The database stores only its
 * SHA-256 hex (`meetings.reschedule_token_hash`, 64 chars) plus a 14-day expiry.
 * Resolving an incoming link means hashing the presented raw token and matching
 * the hash — the raw value is never used in a query.
 */

/** Token lifetime. Locked at 14 days. */
export const RESCHEDULE_TOKEN_TTL_DAYS = 14;
const TTL_MS = RESCHEDULE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 32 random bytes → base64url (no padding) = exactly 43 chars. */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedRescheduleToken {
  /** The raw token — goes ONLY into the emailed URL. Never store this. */
  rawToken: string;
  /** SHA-256 hex of the raw token — the ONLY value persisted. */
  tokenHash: string;
  /** ISO expiry, now + 14 days. */
  expiresAt: string;
}

/** SHA-256 hex of a raw token. Deterministic; the one hashing path. */
export function hashRescheduleToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Is this a structurally valid raw token? Lets the resolver reject obvious
 * garbage before touching the database (no needless query, no enumeration
 * signal). A well-formed token still has to match a live hash to be usable.
 */
export function isWellFormedRawToken(value: unknown): value is string {
  return typeof value === "string" && RAW_TOKEN_PATTERN.test(value);
}

/**
 * Mint a fresh token: cryptographically random raw value, its hash, and a
 * 14-day expiry. `now` is injectable for deterministic tests.
 */
export function issueRescheduleToken(now: Date = new Date()): IssuedRescheduleToken {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashRescheduleToken(rawToken),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };
}
