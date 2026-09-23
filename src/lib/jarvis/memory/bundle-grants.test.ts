import { describe, it, expect } from "vitest";
import { BUNDLES, BUNDLE_PREFIX, ALLOWED_GRANT_KEYS } from "../bundles";
import { GRANT_MEMORY_READ, GRANT_MEMORY_PROPOSE } from "../constants";

/**
 * Anti-drift guard: the capability-aware RLS helper `jarvis_can_read_memory()`
 * (migration 0064) hardcodes the grant keys that confer memory.read:
 *   ('memory.read', 'bundle:founder', 'bundle:readonly_staff').
 * If a bundle stops conferring memory.read in code, this test fails so the SQL
 * (and RLS behaviour) is reviewed in the same change.
 */
const SQL_MEMORY_READ_GRANTS = ["memory.read", "bundle:founder", "bundle:readonly_staff"];

describe("memory grants ↔ RLS bundle mapping", () => {
  it("founder and readonly_staff bundles both confer memory.read", () => {
    expect(BUNDLES.founder).toContain(GRANT_MEMORY_READ);
    expect(BUNDLES.readonly_staff).toContain(GRANT_MEMORY_READ);
  });

  it("founder bundle confers memory.propose; readonly_staff does NOT", () => {
    expect(BUNDLES.founder).toContain(GRANT_MEMORY_PROPOSE);
    expect(BUNDLES.readonly_staff).not.toContain(GRANT_MEMORY_PROPOSE);
  });

  it("every bundle the SQL treats as a memory reader actually confers memory.read", () => {
    for (const key of SQL_MEMORY_READ_GRANTS) {
      if (key === GRANT_MEMORY_READ) continue;
      const bundleName = key.slice(BUNDLE_PREFIX.length);
      expect(BUNDLES[bundleName], `bundle ${bundleName} must confer memory.read (SQL relies on it)`).toContain(
        GRANT_MEMORY_READ
      );
    }
  });

  it("memory grants are assignable via the whitelist", () => {
    expect(ALLOWED_GRANT_KEYS.has(GRANT_MEMORY_READ)).toBe(true);
    expect(ALLOWED_GRANT_KEYS.has(GRANT_MEMORY_PROPOSE)).toBe(true);
  });
});
