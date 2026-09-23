import { describe, it, expect, beforeEach, vi } from "vitest";

// requireAdmin is the V1 route gate (redirects clients/reps in real use); here it
// returns an admin so we can exercise the grant/workspace fail-closed logic.
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin1", role: "admin" }) }));

let workspaceId: string | null = "w1";
let grantRows: { grant_key: string }[] = [{ grant_key: "bundle:founder" }];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: workspaceId }),
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      (b as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: grantRows }).then(res);
      return b;
    },
  }),
}));

import { resolveJarvisContext } from "./identity";

beforeEach(() => {
  workspaceId = "w1";
  grantRows = [{ grant_key: "bundle:founder" }];
});

describe("resolveJarvisContext — fail-closed", () => {
  it("admin + agency workspace + founder bundle → enabled context", async () => {
    const ctx = await resolveJarvisContext();
    expect("denied" in ctx).toBe(false);
    if (!("denied" in ctx)) {
      expect(ctx.principalId).toBe("admin1");
      expect(ctx.workspaceId).toBe("w1");
      expect(ctx.grants.has("jarvis.use")).toBe(true);
      expect(ctx.grants.has("jarvis.approve")).toBe(true);
    }
  });

  it("admin WITHOUT any jarvis grant → denied (not_enabled)", async () => {
    grantRows = [];
    expect(await resolveJarvisContext()).toEqual({ denied: "not_enabled" });
  });

  it("admin whose grants lack jarvis.use → denied", async () => {
    grantRows = [{ grant_key: "portal.read" }]; // no jarvis.use
    expect(await resolveJarvisContext()).toEqual({ denied: "not_enabled" });
  });

  it("agency workspace unresolvable → denied (no_workspace), fail-closed", async () => {
    workspaceId = null;
    expect(await resolveJarvisContext()).toEqual({ denied: "no_workspace" });
  });
});
