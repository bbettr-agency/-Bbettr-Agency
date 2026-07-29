import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * Reusable symmetric encryption for OAuth tokens at rest (AES-256-GCM).
 *
 * Provider-agnostic: any integration can encrypt a secret before it touches the
 * database and decrypt it only in trusted server code. Google is the first
 * consumer; QuickBooks' own copy can migrate onto this later.
 *
 * The 32-byte key is derived from a caller-supplied secret (any length) via
 * SHA-256, so the secret can be any high-entropy string. Stored format is a
 * single string, each part base64:
 *   <iv>.<authTag>.<ciphertext>
 */

const ALGO = "aes-256-gcm";

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Encrypt `plaintext` under `secret`. Output is safe to persist as text. */
export function encryptToken(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

/** Decrypt a value produced by {@link encryptToken}. Throws if tampered/malformed. */
export function decryptToken(payload: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token.");
  }
  const decipher = createDecipheriv(
    ALGO,
    keyFrom(secret),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
