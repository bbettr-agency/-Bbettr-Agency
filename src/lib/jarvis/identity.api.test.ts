import { describe, it, expect, vi, beforeEach } from "vitest";

// Prove the API resolver NEVER redirects: any redirect() call throws loudly.
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("redirect() must NEVER be called by the API resolver");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./grants", () => ({ resolveEffectiveGrants: vi.fn() }));

import { resolveJarvisContextApi } from "./identity";
import { GRANT_JARVIS_USE } from "./constants";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveEffectiveGrants } from "./grants";

const WS = "ws-1";
const adminProfile = { id: "u1", role: "admin" } as never;

function withWorkspace(ws: string | null) {
  vi.mocked(createClient).mockResolvedValue({ rpc: vi.fn(async () => ({ data: ws })) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  redirect.mockImplementation(() => {
    throw new Error("redirect() must NEVER be called by the API resolver");
  });
});

describe("resolveJarvisContextApi — non-redirecting, fail-closed", () => {
  it("unauthenticated (no profile) → denied unauthenticated, no redirect", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    const r = await resolveJarvisContextApi();
    expect(r).toEqual({ denied: "unauthenticated" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["client", "rep"] as const)("role %s → denied forbidden_role, no redirect", async (role) => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ id: "u1", role } as never);
    const r = await resolveJarvisContextApi();
    expect(r).toEqual({ denied: "forbidden_role" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("admin without a resolvable workspace → denied no_workspace", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(adminProfile);
    withWorkspace(null);
    const r = await resolveJarvisContextApi();
    expect(r).toEqual({ denied: "no_workspace" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("admin + workspace but WITHOUT jarvis.use → denied not_enabled", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(adminProfile);
    withWorkspace(WS);
    vi.mocked(resolveEffectiveGrants).mockResolvedValue(new Set<string>());
    const r = await resolveJarvisContextApi();
    expect(r).toEqual({ denied: "not_enabled" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("authorized admin with jarvis.use → trusted JarvisContext (workspace/user server-derived)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(adminProfile);
    withWorkspace(WS);
    vi.mocked(resolveEffectiveGrants).mockResolvedValue(new Set([GRANT_JARVIS_USE]));
    const r = await resolveJarvisContextApi();
    expect(r).toEqual({ principalId: "u1", workspaceId: WS, grants: new Set([GRANT_JARVIS_USE]) });
    expect(redirect).not.toHaveBeenCalled();
  });
});
