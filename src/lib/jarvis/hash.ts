import { createHash } from "node:crypto";

/**
 * Canonical effect hash for approval binding (Foundation 1). Pure.
 *
 * An approval binds to the EXACT proposed effect via this hash. Execution
 * re-computes it and must match, so an approved proposal can never be executed
 * with materially different content (e.g. approve one email, send another).
 * Uses a stable, key-sorted JSON encoding so equal effects hash equally.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function canonicalEffectHash(effect: unknown): string {
  return createHash("sha256").update(stableStringify(effect)).digest("hex");
}
