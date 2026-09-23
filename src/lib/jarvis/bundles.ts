/**
 * Jarvis capability BUNDLES (Foundation 1). Pure, code-defined.
 *
 * Grants are DATA (stored in jarvis_capability_grants) keyed by profiles.id — no
 * founder email hardcoding anywhere. A grant row's `grant_key` is either a
 * capability id (e.g. 'portal.read') or a bundle marker ('bundle:founder'),
 * expanded here. Default-deny: no row ⇒ no capability.
 *
 * IMPORTANT (approved correction): a bundle/grant may be assigned to ANY profile,
 * including a future non-admin staff member — the model does not require
 * role='admin'. The V1 *UI/route* is admin-only, but the capability model is not.
 */
import { GRANT_JARVIS_USE, GRANT_JARVIS_APPROVE, GRANT_MEMORY_READ, GRANT_MEMORY_PROPOSE } from "./constants";

/** Prefix that marks a grant_key as a bundle to be expanded. */
export const BUNDLE_PREFIX = "bundle:" as const;

/** Bundle → the concrete capability/grant keys it confers. */
export const BUNDLES: Record<string, readonly string[]> = {
  // Founder-level Jarvis access (Eloff, Ashwin — assigned as DATA, never by email
  // in code). Includes approval authority.
  founder: [
    GRANT_JARVIS_USE,
    "portal.read",
    "portal.tasks.write",
    "integrations.read",
    GRANT_JARVIS_APPROVE,
    // Memory V1: founders may read/assemble context, propose memories, and — via
    // the reused GRANT_JARVIS_APPROVE authority above — confirm/correct/retire.
    GRANT_MEMORY_READ,
    GRANT_MEMORY_PROPOSE,
  ],
  // Future narrow staff bundle (structurally supported; not assigned to anyone
  // in Foundation 1) — read-only, no approval authority. May read memory/context
  // but cannot propose, confirm, correct or retire.
  readonly_staff: [GRANT_JARVIS_USE, "portal.read", GRANT_MEMORY_READ],
};

/**
 * Expand a set of stored grant_keys (capability ids and/or 'bundle:*' markers)
 * into the flat set of effective grant keys. Unknown bundles expand to nothing
 * (fail-closed). Pure.
 */
export function expandGrantKeys(storedKeys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const key of storedKeys) {
    if (key.startsWith(BUNDLE_PREFIX)) {
      const bundle = BUNDLES[key.slice(BUNDLE_PREFIX.length)];
      if (bundle) for (const k of bundle) out.add(k);
      // unknown bundle → contributes nothing
    } else {
      out.add(key);
    }
  }
  return out;
}

/**
 * Grant keys an admin may ASSIGN via the management action — the bundle markers
 * plus every capability/grant key any bundle confers. An arbitrary/unknown key
 * is rejected (fail-closed), so a mistyped or injected grant string can never be
 * stored. Pure.
 */
export const ALLOWED_GRANT_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const [bundleName, caps] of Object.entries(BUNDLES)) {
    keys.add(`${BUNDLE_PREFIX}${bundleName}`);
    for (const c of caps) keys.add(c);
  }
  return keys;
})();

export function isAssignableGrantKey(key: string): boolean {
  return ALLOWED_GRANT_KEYS.has(key);
}
