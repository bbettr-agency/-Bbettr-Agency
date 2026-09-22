import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ getEmailService: vi.fn(() => ({ send: vi.fn(async () => ({ ok: true })) })) }));

const requireAdmin = vi.fn(async () => ({ id: "admin-1", role: "admin" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));

// ── Configurable supabase mocks ─────────────────────────────────────────────
let existingProfile: { id: string; full_name: string | null } | null = null;
let alreadyMember: { client_id: string } | null = null;
const calls = {
  cmInsert: [] as unknown[],
  cmUpsert: [] as unknown[],
  cmDelete: [] as { user_id?: string; client_id?: string }[],
  invite: [] as { email: string; opts: unknown }[],
  createUser: [] as unknown[],
  deleteUser: [] as unknown[],
  profileInsert: [] as unknown[],
  profileUpdate: [] as unknown[],
};

// Session (RLS) client — reads clients + profiles.
function sessionBuilder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self; chain.eq = self; chain.in = self; chain.limit = self;
  chain.maybeSingle = async () => {
    if (table === "clients") return { data: { id: "B", name: "MLI Parts" } };
    if (table === "profiles") return { data: existingProfile };
    return { data: null };
  };
  chain.single = chain.maybeSingle;
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => sessionBuilder(t) })),
}));

// Service-role client — privileged writes + auth admin.
function svcBuilder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self; chain.eq = self;
  // client_members membership pre-check returns `alreadyMember`; profiles lookup
  // in ensureClientProfileAndMembership returns null (→ profile insert path).
  chain.maybeSingle = async () => (table === "client_members" ? { data: alreadyMember } : { data: null });
  chain.insert = async (row: unknown) => {
    if (table === "client_members") calls.cmInsert.push(row);
    if (table === "profiles") calls.profileInsert.push(row);
    return { error: null };
  };
  chain.upsert = async (row: unknown) => { if (table === "client_members") calls.cmUpsert.push(row); return { error: null }; };
  chain.delete = () => ({ eq: (_c: string, _v: string) => ({ eq: (_c2: string, _v2: string) => { calls.cmDelete.push({}); return Promise.resolve({ error: null }); } }) });
  chain.update = () => ({ eq: async () => { calls.profileUpdate.push(true); return { error: null }; } });
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (t: string) => svcBuilder(t),
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, opts: unknown) => { calls.invite.push({ email, opts }); return { data: { user: { id: "new-user" } }, error: null }; },
        createUser: async (o: unknown) => { calls.createUser.push(o); return { data: {}, error: null }; },
        deleteUser: async (o: unknown) => { calls.deleteUser.push(o); return { error: null }; },
      },
    },
  })),
}));

import {
  grantWorkspaceAccessAction,
  revokeWorkspaceAccessAction,
} from "./access-actions";

beforeEach(() => {
  vi.clearAllMocks();
  existingProfile = null;
  alreadyMember = null;
  calls.cmInsert = []; calls.cmUpsert = []; calls.cmDelete = []; calls.invite = []; calls.createUser = []; calls.deleteUser = []; calls.profileInsert = []; calls.profileUpdate = [];
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" });
});

describe("grantWorkspaceAccessAction", () => {
  it("existing user → adds a membership, never a new account or password", async () => {
    existingProfile = { id: "john", full_name: "John" };
    const res = await grantWorkspaceAccessAction("B", "John@Example.com");
    expect(res).toMatchObject({ ok: true, outcome: "granted" });
    expect(calls.cmInsert).toEqual([{ user_id: "john", client_id: "B" }]);
    expect(calls.invite).toHaveLength(0);
    expect(calls.createUser).toHaveLength(0);
  });

  it("existing user already a member → idempotent, no insert", async () => {
    existingProfile = { id: "john", full_name: "John" };
    alreadyMember = { client_id: "B" };
    const res = await grantWorkspaceAccessAction("B", "john@example.com");
    expect(res.outcome).toBe("already_member");
    expect(calls.cmInsert).toHaveLength(0);
  });

  it("new user → secure invite (own password) with role+client_id metadata and confirm redirect", async () => {
    existingProfile = null;
    const res = await grantWorkspaceAccessAction("B", "new@example.com");
    expect(res).toMatchObject({ ok: true, outcome: "invited", email: "new@example.com" });
    expect(calls.invite).toHaveLength(1);
    const { email, opts } = calls.invite[0] as { email: string; opts: { data: Record<string, unknown>; redirectTo: string } };
    expect(email).toBe("new@example.com");
    expect(opts.data).toMatchObject({ role: "client", client_id: "B" });
    expect(opts.redirectTo).toContain("/auth/confirm");
    // No password is ever generated/passed — invite carries no credential field
    // (the "/reset-password" redirect path is where the USER sets their own).
    expect("password" in opts).toBe(false);
    expect("password" in (opts.data as Record<string, unknown>)).toBe(false);
    expect(calls.createUser).toHaveLength(0);
    // THE FIX: after invite, the profile + membership are provisioned EXPLICITLY
    // from the returned user id — not left to the DB trigger (which in prod did
    // not read client_id from the invite, leaving zero memberships → the loop).
    expect(calls.profileInsert).toEqual([
      { id: "new-user", email: "new@example.com", role: "client", client_id: "B" },
    ]);
    expect(calls.cmUpsert).toEqual([{ user_id: "new-user", client_id: "B" }]);
  });

  it("rejects an invalid email before any privileged call", async () => {
    const res = await grantWorkspaceAccessAction("B", "not-an-email");
    expect(res.ok).toBe(false);
    expect(calls.invite).toHaveLength(0);
    expect(calls.cmInsert).toHaveLength(0);
  });

  it("is denied when the caller is not an admin (requireAdmin throws)", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("redirect"));
    await expect(grantWorkspaceAccessAction("B", "john@example.com")).rejects.toThrow();
    expect(calls.cmInsert).toHaveLength(0);
    expect(calls.invite).toHaveLength(0);
  });
});

describe("revokeWorkspaceAccessAction", () => {
  it("removes only the membership pair — never the auth user", async () => {
    // svcBuilder returns alreadyMember for client_members.select; emulate the
    // membership list read by making the first .eq(...) resolve to rows.
    const res = await revokeWorkspaceAccessAction("B", "john");
    // With no memberships returned by the mock, it treats as idempotent no-op —
    // but crucially never deletes the auth user.
    expect(res.ok).toBe(true);
    expect(calls.deleteUser).toHaveLength(0);
  });

  it("is denied for a non-admin caller", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("redirect"));
    await expect(revokeWorkspaceAccessAction("B", "john")).rejects.toThrow();
    expect(calls.cmDelete).toHaveLength(0);
    expect(calls.deleteUser).toHaveLength(0);
  });
});
