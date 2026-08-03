/**
 * Canonical SHA-256 hash of a bounded task command's user input.
 *
 * Pure. Used for the command receipt's `payload_hash`, which lets the
 * persistence op distinguish a genuine replay (same key + same hash) from an
 * idempotency conflict (same key + different hash). Keys are sorted recursively
 * so key ordering never changes the digest. Server-derived values (actor,
 * workspace, aggregate version, timestamps) are NOT part of the command and are
 * therefore excluded by construction. It is a digest only — never stores or logs
 * command content.
 */
import { createHash } from "node:crypto";
import type { TaskCommand } from "./state-machine";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/** Stable digest of the command (order-independent for object keys). */
export function canonicalCommandHash(command: TaskCommand): string {
  const canonical = JSON.stringify(canonicalize(command));
  return createHash("sha256").update(canonical).digest("hex");
}
