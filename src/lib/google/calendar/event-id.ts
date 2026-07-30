/**
 * Deterministic Google Calendar event ids.
 *
 * Google requires event ids to be base32hex — lowercase `a`–`v` and digits
 * `0`–`9`, length 5–1024. We derive the id deterministically from the Portal
 * entity's UUID plus an `idEpoch`, so:
 *  - the SAME entity always maps to the SAME id → creating twice is idempotent
 *    (Google rejects the duplicate id, which we treat as success);
 *  - a rebuild bumps `idEpoch` to mint a FRESH id namespace, avoiding Google's
 *    restriction on reusing a just-deleted event id.
 *
 * Pure module (no secrets, no I/O) so it is directly unit-testable.
 */

// RFC 4648 base32hex alphabet — exactly Google's allowed id charset.
const B32HEX = "0123456789abcdefghijklmnopqrstuv";

/** Encode bytes as base32hex (no padding). */
export function encodeBase32hex(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32HEX[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Deterministic Google event id for a Portal entity at a given projection epoch.
 * Encodes the 16 UUID bytes + 4 big-endian epoch bytes → 32 base32hex chars.
 */
export function googleEventId(entityId: string, idEpoch: number): string {
  const hex = entityId.replace(/-/g, "").toLowerCase();
  if (hex.length !== 32 || /[^0-9a-f]/.test(hex)) {
    throw new Error(`googleEventId: not a valid UUID: ${entityId}`);
  }
  if (!Number.isInteger(idEpoch) || idEpoch < 0 || idEpoch > 0xffffffff) {
    throw new Error(`googleEventId: idEpoch out of range: ${idEpoch}`);
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  bytes[16] = (idEpoch >>> 24) & 0xff;
  bytes[17] = (idEpoch >>> 16) & 0xff;
  bytes[18] = (idEpoch >>> 8) & 0xff;
  bytes[19] = idEpoch & 0xff;
  return encodeBase32hex(bytes);
}

/**
 * Deterministic Google Meet `requestId` for a meeting at a given epoch, so
 * re-issuing a conference request never mints a second conference.
 */
export function meetRequestId(entityId: string, idEpoch: number): string {
  return `meet-${googleEventId(entityId, idEpoch)}`;
}
