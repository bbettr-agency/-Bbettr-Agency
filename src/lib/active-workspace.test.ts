import { describe, it, expect } from "vitest";
import {
  resolveActiveWorkspace,
  canActivateWorkspace,
  isSafeReturnPath,
  safeSwitchReturnPath,
  buildWorkspaceMenu,
  ACTIVE_WORKSPACE_COOKIE,
} from "./active-workspace";

const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";
const C = "00000000-0000-0000-0000-0000000000cc";

describe("resolveActiveWorkspace", () => {
  it("zero memberships → null (fail safe, never guess)", () => {
    expect(resolveActiveWorkspace({ memberships: [], legacyClientId: A, stored: A })).toEqual({
      activeClientId: null,
      source: "none",
    });
  });

  it("single membership → that workspace (existing clients: no change)", () => {
    expect(resolveActiveWorkspace({ memberships: [A], legacyClientId: A, stored: null })).toEqual({
      activeClientId: A,
      source: "legacy_default",
    });
  });

  it("single membership ignores an unrelated legacy default and resolves the membership", () => {
    // Defensive: legacy points elsewhere but only A is a real membership.
    const r = resolveActiveWorkspace({ memberships: [A], legacyClientId: C, stored: null });
    expect(r.activeClientId).toBe(A);
    expect(r.source).toBe("fallback");
  });

  it("multi-membership, no stored pref → deterministic legacy default", () => {
    expect(resolveActiveWorkspace({ memberships: [A, B], legacyClientId: A, stored: null })).toEqual({
      activeClientId: A,
      source: "legacy_default",
    });
  });

  it("multi-membership, valid stored pref (member) → that workspace", () => {
    expect(resolveActiveWorkspace({ memberships: [A, B], legacyClientId: A, stored: B })).toEqual({
      activeClientId: B,
      source: "stored",
    });
  });

  it("stored pref that is NOT a membership is discarded (tamper/stale) → legacy default", () => {
    const r = resolveActiveWorkspace({ memberships: [A, B], legacyClientId: A, stored: C });
    expect(r.activeClientId).toBe(A);
    expect(r.source).toBe("legacy_default");
  });

  it("revoked membership: stored B no longer a member → falls back to still-valid legacy A", () => {
    // Simulates B membership revoked while cookie still says B.
    const r = resolveActiveWorkspace({ memberships: [A], legacyClientId: A, stored: B });
    expect(r.activeClientId).toBe(A);
    expect(r.source).toBe("legacy_default");
  });

  it("legacy default no longer a member → deterministic lowest-id fallback", () => {
    // legacy A revoked; user still has B and C. Fallback is the lowest id (B < C).
    const r = resolveActiveWorkspace({ memberships: [C, B], legacyClientId: A, stored: null });
    expect(r.activeClientId).toBe(B);
    expect(r.source).toBe("fallback");
  });

  it("fallback ordering is deterministic regardless of input order", () => {
    const r1 = resolveActiveWorkspace({ memberships: [C, B], legacyClientId: null, stored: null });
    const r2 = resolveActiveWorkspace({ memberships: [B, C], legacyClientId: null, stored: null });
    expect(r1.activeClientId).toBe(B);
    expect(r2.activeClientId).toBe(B);
  });

  it("a null/empty stored value is ignored", () => {
    expect(resolveActiveWorkspace({ memberships: [A, B], legacyClientId: B, stored: "" }).activeClientId).toBe(B);
  });
});

describe("canActivateWorkspace", () => {
  it("true only for a workspace the user is a member of", () => {
    expect(canActivateWorkspace(B, [A, B])).toBe(true);
    expect(canActivateWorkspace(C, [A, B])).toBe(false);
    expect(canActivateWorkspace(A, [])).toBe(false);
  });
});

describe("isSafeReturnPath", () => {
  it("accepts same-origin absolute paths", () => {
    expect(isSafeReturnPath("/dashboard")).toBe(true);
    expect(isSafeReturnPath("/dashboard/files?x=1")).toBe(true);
  });
  it("rejects open-redirect vectors", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("http://evil.com")).toBe(false);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
    expect(isSafeReturnPath("dashboard")).toBe(false); // no leading slash
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });
});

describe("cookie name", () => {
  it("is a stable, non-sensitive name", () => {
    expect(ACTIVE_WORKSPACE_COOKIE).toBe("bbettr_active_workspace");
  });
});

describe("safeSwitchReturnPath (S4B route safety)", () => {
  it("keeps the user on a known workspace-agnostic client route", () => {
    for (const p of ["/dashboard", "/dashboard/onboarding", "/dashboard/project", "/dashboard/updates", "/dashboard/reports", "/dashboard/files", "/dashboard/invoices", "/dashboard/contracts"]) {
      expect(safeSwitchReturnPath(p)).toBe(p);
    }
  });
  it("strips query/hash before matching", () => {
    expect(safeSwitchReturnPath("/dashboard/updates?x=1#top")).toBe("/dashboard/updates");
  });
  it("falls back to /dashboard for unknown / nested / entity-looking routes", () => {
    expect(safeSwitchReturnPath("/dashboard/updates/some-id")).toBe("/dashboard");
    expect(safeSwitchReturnPath("/admin/clients/123")).toBe("/dashboard");
    expect(safeSwitchReturnPath("")).toBe("/dashboard");
    expect(safeSwitchReturnPath(null)).toBe("/dashboard");
    expect(safeSwitchReturnPath("//evil.com")).toBe("/dashboard");
  });
});

describe("buildWorkspaceMenu (S4B switcher view model)", () => {
  const A = "00000000-0000-0000-0000-0000000000aa";
  const B = "00000000-0000-0000-0000-0000000000bb";
  it("sorts by name, flags the active one, exposes its display name (never a UUID)", () => {
    const menu = buildWorkspaceMenu(B, [
      { id: A, name: "MLI Automotive" },
      { id: B, name: "MLI Parts" },
    ]);
    expect(menu.activeName).toBe("MLI Parts");
    expect(menu.options.map((o) => o.name)).toEqual(["MLI Automotive", "MLI Parts"]);
    expect(menu.options.find((o) => o.id === B)?.isActive).toBe(true);
    expect(menu.options.find((o) => o.id === A)?.isActive).toBe(false);
  });
  it("activeName is null when the active id isn't among the workspaces", () => {
    expect(buildWorkspaceMenu("zzz", [{ id: A, name: "A" }]).activeName).toBeNull();
  });
});
