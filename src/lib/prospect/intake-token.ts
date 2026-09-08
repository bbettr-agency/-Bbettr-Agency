import "server-only";
import { randomBytes, createHash } from "node:crypto";

/**
 * Secure prospect-intake link token (P1) — mirrors the reschedule-token
 * precedent (migration 0053) exactly.
 *
 * The RAW token is the prospect's authorization and identity for a resumable
 * intake: it exists ONLY in the `/start/<raw>` URL and is never persisted. The
 * database stores only its SHA-256 hex (`prospect_intakes.token_hash`, 64
 * chars) plus an expiry. Resolving an incoming link means hashing the presented
 * raw token and matching the hash — the raw value is never used in a query.
 *
 * Unlike the single-use reschedule token, an intake token is RESUMABLE: a draft
 * may be opened and saved repeatedly until submission. The capability rules
 * (read/mutate by lifecycle state) live in intake-lifecycle.ts.
 */

/** Token lifetime. 30 days — prospects may take time between sales touches. */
export const INTAKE_TOKEN_TTL_DAYS = 30;
const TTL_MS = INTAKE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 32 random bytes → base64url (no padding) = exactly 43 chars. */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedIntakeToken {
  /** The raw token — goes ONLY into the URL. Never store this. */
  rawToken: string;
  /** SHA-256 hex of the raw token — the ONLY value persisted. */
  tokenHash: string;
  /** ISO expiry, now + TTL. */
  expiresAt: string;
}

/** SHA-256 hex of a raw token. Deterministic; the one hashing path. */
export function hashIntakeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Is this a structurally valid raw token? Lets the resolver reject obvious
 * garbage before touching the database (no needless query, no enumeration
 * signal). A well-formed token still has to match a live hash to be usable.
 */
export function isWellFormedIntakeToken(value: unknown): value is string {
  return typeof value === "string" && RAW_TOKEN_PATTERN.test(value);
}

/**
 * Mint a fresh token: cryptographically random raw value, its hash, and an
 * expiry. `now` is injectable for deterministic tests.
 */
export function issueIntakeToken(now: Date = new Date()): IssuedIntakeToken {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashIntakeToken(rawToken),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };
}

/** True when the token has passed its expiry. `now` injectable for tests. */
export function isIntakeTokenExpired(
  expiresAt: string,
  now: Date = new Date()
): boolean {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true; // unparseable expiry ⇒ treat as expired (fail closed)
  return now.getTime() >= t;
}
