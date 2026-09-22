import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ getEmailService: vi.fn(() => ({ send: vi.fn(async () => ({ ok: true })) })) }));

const requireAdmin = vi.fn(async () => ({ id: "admin-1", role: "admin" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));

// ── Configurable identity / DB state ────────────────────────────────────────
let authUsers: { id: string; email: string }[] = [];
let svcProfile: { id: string; role: string; client_id: string | null; email: string | null } | null = null;
let membershipPreexists: { client_id: string } | null = null; // pre-check result
let membershipPersisted = true; // what read-after-write confirms
let errInsert: { message: string } | null = null;
let errUpdate: { message: string } | null = null;
let errUpsert: { message: string } | null = null;
const calls = {
  profileInsert: [] as unknown[],
  profileUpdate: [] as unknown[],
  cmUpsert: [] as unknown[],
  invite: [] as { email: string; opts: unknown }[],
  createUser: [] as unknown[],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "B", name: "MLI Parts" } }) }) }) }),
  })),
}));

function svcBuilder(table: string) {
  const chain: Record<string, unknown> = { _cols: "" };
  const self = () => chain;
  chain.select = (cols: string) => { chain._cols = cols; return chain; };
  chain.eq = self;
  chain.maybeSingle = async () => {
    if (table === "profiles") return { data: svcProfile, error: null };
    // client_members: the read-after-write verify selects "user_id, client_id";
    // the idempotent pre-check selects just "client_id".
    const isVerify = String(chain._cols).includes("user_id");
    if (isVerify) return { data: membershipPersisted ? { user_id: "u", client_id: "B" } : null, error: null };
    return { data: membershipPreexists, error: null };
  };
  chain.insert = async (row: unknown) => { if (table === "profiles") { calls.profileInsert.push(row); return { error: errInsert }; } return { error: null }; };
  chain.upsert = async (row: unknown) => { if (table === "client_members") { calls.cmUpsert.push(row); return { error: errUpsert }; } return { error: null }; };
  chain.update = (patch: unknown) => ({ eq: async () => { if (table === "profiles") { calls.profileUpdate.push(patch); return { error: errUpdate }; } return { error: null }; } });
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (t: string) => svcBuilder(t),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        inviteUserByEmail: async (email: string, opts: unknown) => { calls.invite.push({ email, opts }); return { data: { user: { id: "new-user" } }, error: null }; },
        createUser: async (o: unknown) => { calls.createUser.push(o); return { data: {}, error: null }; },
      },
    },
  })),
}));

import { grantWorkspaceAccessAction } from "./access-actions";

beforeEach(() => {
  vi.clearAllMocks();
  authUsers = []; svcProfile = null; membershipPreexists = null; membershipPersisted = true;
  errInsert = null; errUpdate = null; errUpsert = null;
  calls.profileInsert = []; calls.profileUpdate = []; calls.cmUpsert = []; calls.invite = []; calls.createUser = [];
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" });
});

const healthy = () => { authUsers = [{ id: "amy", email: "amy@example.com" }]; svcProfile = { id: "amy", role: "client", client_id: "A", email: "amy@example.com" }; };

describe("grantWorkspaceAccessAction — write-error + read-after-write hardening", () => {
  it("1. successful membership persistence → success", async () => {
    healthy();
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res).toMatchObject({ ok: true, outcome: "granted" });
    expect(calls.cmUpsert).toEqual([{ user_id: "amy", client_id: "B" }]);
  });

  it("2. profile insert failure → failure, no false success", async () => {
    authUsers = [{ id: "ghost", email: "g@example.com" }]; svcProfile = null; // missing profile → insert path
    errInsert = { message: "insert boom" };
    const res = await grantWorkspaceAccessAction("B", "g@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server logs/i);
    expect(calls.cmUpsert).toHaveLength(0); // never reached membership write
  });

  it("3. profile update failure → failure, no false success", async () => {
    authUsers = [{ id: "brk", email: "b@example.com" }];
    svcProfile = { id: "brk", role: "client", client_id: null, email: "b@example.com" }; // needs client_id patch
    errUpdate = { message: "update boom" };
    const res = await grantWorkspaceAccessAction("B", "b@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server logs/i);
    expect(calls.cmUpsert).toHaveLength(0);
  });

  it("4. membership upsert failure → failure, no false success", async () => {
    healthy();
    errUpsert = { message: "upsert boom" };
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server logs/i);
    expect(calls.cmUpsert).toHaveLength(1); // write attempted, but error surfaced
  });

  it("5. read-after-write FINDS membership → success", async () => {
    healthy();
    membershipPersisted = true;
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.ok).toBe(true);
  });

  it("6. read-after-write CANNOT find membership → failure (no false green success)", async () => {
    healthy();
    errUpsert = null; // the write 'succeeded' (no error)…
    membershipPersisted = false; // …but verification finds nothing → must fail
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server logs/i);
  });

  it("7. existing healthy multi-workspace user stays safe (default A preserved, B added)", async () => {
    healthy(); // default A
    const res = await grantWorkspaceAccessAction("B", "amy@example.com");
    expect(res.ok).toBe(true);
    // default A must NOT be overwritten
    expect(calls.profileUpdate.flatMap((p) => Object.keys(p as object))).not.toContain("client_id");
    expect(calls.cmUpsert).toEqual([{ user_id: "amy", client_id: "B" }]);
  });

  it("8. internal admin/rep identity remains rejected, role untouched, no writes", async () => {
    authUsers = [{ id: "boss", email: "boss@bbettr.com" }];
    svcProfile = { id: "boss", role: "admin", client_id: null, email: "boss@bbettr.com" };
    const res = await grantWorkspaceAccessAction("B", "boss@bbettr.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/internal Bbettr user/i);
    expect(calls.cmUpsert).toHaveLength(0);
    expect(calls.profileUpdate).toHaveLength(0);
    expect(calls.profileInsert).toHaveLength(0);
  });

  it("brand-new email still invites + provisions (verified) → success", async () => {
    authUsers = []; svcProfile = null; membershipPersisted = true;
    const res = await grantWorkspaceAccessAction("B", "new@example.com");
    expect(res.outcome).toBe("invited");
    expect(calls.invite).toHaveLength(1);
    expect(calls.cmUpsert).toEqual([{ user_id: "new-user", client_id: "B" }]);
  });

  it("brand-new invite whose membership fails to persist → failure (no false success)", async () => {
    authUsers = []; svcProfile = null; membershipPersisted = false;
    const res = await grantWorkspaceAccessAction("B", "new@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server logs/i);
  });

  it("invalid email is rejected before any privileged call", async () => {
    const res = await grantWorkspaceAccessAction("B", "not-an-email");
    expect(res.ok).toBe(false);
    expect(calls.invite).toHaveLength(0);
    expect(calls.cmUpsert).toHaveLength(0);
  });

  it("non-admin caller is denied (no privileged calls)", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("redirect"));
    await expect(grantWorkspaceAccessAction("B", "amy@example.com")).rejects.toThrow();
    expect(calls.cmUpsert).toHaveLength(0);
    expect(calls.invite).toHaveLength(0);
  });
});
