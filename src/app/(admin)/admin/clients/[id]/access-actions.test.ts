import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ getEmailService: vi.fn(() => ({ send: vi.fn(async () => ({ ok: true })) })) }));

const requireAdmin = vi.fn(async () => ({ id: "admin-1", role: "admin" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));

// ── Configurable identity/state ─────────────────────────────────────────────
let authUsers: { id: string; email: string }[] = []; // what listUsers returns
let svcProfile: { id: string; role: string; client_id: string | null; email: string | null } | null = null;
let alreadyMember: { client_id: string } | null = null;
const calls = {
  profileInsert: [] as unknown[],
  profileUpdate: [] as unknown[],
  cmUpsert: [] as unknown[],
  invite: [] as { email: string; opts: unknown }[],
  createUser: [] as unknown[],
  deleteUser: [] as unknown[],
  listUsers: 0,
};

// Session (RLS) client — only reads clients here.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (_t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "B", name: "MLI Parts" } }) }) }) }),
  })),
}));

function svcBuilder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self; chain.eq = self;
  chain.maybeSingle = async () => (table === "client_members" ? { data: alreadyMember } : { data: svcProfile });
  chain.insert = async (row: unknown) => { if (table === "profiles") calls.profileInsert.push(row); return { error: null }; };
  chain.upsert = async (row: unknown) => { if (table === "client_members") calls.cmUpsert.push(row); return { error: null }; };
  chain.update = (patch: unknown) => ({ eq: async () => { if (table === "profiles") calls.profileUpdate.push(patch); return { error: null }; } });
  chain.delete = () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (t: string) => svcBuilder(t),
    auth: {
      admin: {
        listUsers: async () => { calls.listUsers++; return { data: { users: authUsers }, error: null }; },
        inviteUserByEmail: async (email: string, opts: unknown) => { calls.invite.push({ email, opts }); return { data: { user: { id: "new-user" } }, error: null }; },
        createUser: async (o: unknown) => { calls.createUser.push(o); return { data: {}, error: null }; },
        deleteUser: async (o: unknown) => { calls.deleteUser.push(o); return { error: null }; },
      },
    },
  })),
}));

import { grantWorkspaceAccessAction, revokeWorkspaceAccessAction } from "./access-actions";

beforeEach(() => {
  vi.clearAllMocks();
  authUsers = []; svcProfile = null; alreadyMember = null;
  calls.profileInsert = []; calls.profileUpdate = []; calls.cmUpsert = []; calls.invite = []; calls.createUser = []; calls.deleteUser = []; calls.listUsers = 0;
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" });
});

describe("grantWorkspaceAccessAction — identity-first (auth.users authoritative)", () => {
  it("BROKEN existing user (auth exists, profile client_id NULL, no membership) → REPAIRED, no invite", async () => {
    authUsers = [{ id: "john", email: "john@example.com" }];
    svcProfile = { id: "john", role: "client", client_id: null, email: "john@example.com" };
    const res = await grantWorkspaceAccessAction("B", "John@Example.com");
    expect(res).toMatchObject({ ok: true, outcome: "repaired" });
    expect(calls.invite).toHaveLength(0); // existing account is never re-invited
    expect(calls.createUser).toHaveLength(0);
    expect(calls.profileUpdate).toEqual([{ client_id: "B" }]); // default filled (was null)
    expect(calls.cmUpsert).toEqual([{ user_id: "john", client_id: "B" }]); // membership created
  });

  it("MISSING profile (auth exists, no profile row) → profile created + membership, no invite", async () => {
    authUsers = [{ id: "ghost", email: "ghost@example.com" }];
    svcProfile = null;
    const res = await grantWorkspaceAccessAction("B", "ghost@example.com");
    expect(res.outcome).toBe("repaired");
    expect(calls.invite).toHaveLength(0);
    expect(calls.profileInsert).toEqual([{ id: "ghost", email: "ghost@example.com", role: "client", client_id: "B" }]);
    expect(calls.cmUpsert).toEqual([{ user_id: "ghost", client_id: "B" }]);
  });

  it("HEALTHY existing user (default A) → membership B added, default A NOT changed, outcome granted", async () => {
    authUsers = [{ id: "amy", email: "amy@example.com" }];
    svcProfile = { id: "amy", role: "client", client_id: "A", email: "amy@example.com" };
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.outcome).toBe("granted");
    expect(calls.invite).toHaveLength(0);
    // No client_id change (healthy default preserved); at most a no-op update set.
    expect(calls.profileUpdate.flatMap((p) => Object.keys(p as object))).not.toContain("client_id");
    expect(calls.cmUpsert).toEqual([{ user_id: "amy", client_id: "B" }]);
  });

  it("ALREADY a member → idempotent, no writes", async () => {
    authUsers = [{ id: "amy", email: "amy@example.com" }];
    svcProfile = { id: "amy", role: "client", client_id: "B", email: "amy@example.com" };
    alreadyMember = { client_id: "B" };
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.outcome).toBe("already_member");
    expect(calls.cmUpsert).toHaveLength(0);
    expect(calls.profileInsert).toHaveLength(0);
    expect(calls.profileUpdate).toHaveLength(0);
  });

  it("INTERNAL user (existing profile role=admin) → refused safely, role untouched, no membership", async () => {
    authUsers = [{ id: "boss", email: "boss@bbettr.com" }];
    svcProfile = { id: "boss", role: "admin", client_id: null, email: "boss@bbettr.com" };
    const res = await grantWorkspaceAccessAction("B", "boss@bbettr.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/internal Bbettr user/i);
    expect(calls.cmUpsert).toHaveLength(0);
    expect(calls.profileUpdate).toHaveLength(0);
    expect(calls.invite).toHaveLength(0);
  });

  it("BRAND-NEW email (no auth identity) → invite + explicit provisioning", async () => {
    authUsers = []; // listUsers finds nobody
    svcProfile = null;
    const res = await grantWorkspaceAccessAction("B", "new@example.com");
    expect(res.outcome).toBe("invited");
    expect(calls.invite).toHaveLength(1);
    const { opts } = calls.invite[0] as { opts: { data: Record<string, unknown>; redirectTo: string } };
    expect(opts.data).toMatchObject({ role: "client", client_id: "B" });
    expect(opts.redirectTo).toContain("/auth/confirm");
    expect("password" in opts).toBe(false);
    expect(calls.createUser).toHaveLength(0);
    expect(calls.profileInsert).toEqual([{ id: "new-user", email: "new@example.com", role: "client", client_id: "B" }]);
    expect(calls.cmUpsert).toEqual([{ user_id: "new-user", client_id: "B" }]);
  });

  it("rejects an invalid email before any Auth/DB call", async () => {
    const res = await grantWorkspaceAccessAction("B", "not-an-email");
    expect(res.ok).toBe(false);
    expect(calls.listUsers).toBe(0);
    expect(calls.invite).toHaveLength(0);
  });

  it("denied for a non-admin caller (no privileged calls)", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("redirect"));
    await expect(grantWorkspaceAccessAction("B", "john@example.com")).rejects.toThrow();
    expect(calls.listUsers).toBe(0);
    expect(calls.cmUpsert).toHaveLength(0);
    expect(calls.invite).toHaveLength(0);
  });
});

describe("revokeWorkspaceAccessAction", () => {
  it("never deletes the auth user; denied for non-admins", async () => {
    const res = await revokeWorkspaceAccessAction("B", "john");
    expect(res.ok).toBe(true);
    expect(calls.deleteUser).toHaveLength(0);

    requireAdmin.mockRejectedValueOnce(new Error("redirect"));
    await expect(revokeWorkspaceAccessAction("B", "john")).rejects.toThrow();
    expect(calls.deleteUser).toHaveLength(0);
  });
});
