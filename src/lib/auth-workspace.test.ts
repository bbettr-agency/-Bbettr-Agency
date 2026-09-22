import { describe, it, expect, beforeEach, vi } from "vitest";

// cache() → identity so getCurrentProfile runs plainly in the node test env.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: (fn: unknown) => fn }));

// redirect() throws a marker we can catch and assert on (mirrors Next.js).
const redirectMock = vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); });
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirectMock(p) }));

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (_n: string) => (cookieValue ? { value: cookieValue } : undefined) }),
}));

let profile: { id: string; role: string; client_id: string | null } | null;
let memberships: string[];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: profile ? { id: profile.id } : null } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) };
      }
      // client_members: `await supabase.from('client_members').select('client_id')`
      return { select: () => Promise.resolve({ data: memberships.map((c) => ({ client_id: c })) }) };
    },
  }),
}));

import { requireClientWorkspace } from "./auth";

const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";

async function callExpectingRedirect(): Promise<string | null> {
  try {
    await requireClientWorkspace();
    return null; // no redirect
  } catch (e) {
    const m = (e as Error).message.match(/^REDIRECT:(.*)$/);
    return m ? m[1] : `THROW:${(e as Error).message}`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieValue = undefined;
  profile = { id: "u1", role: "client", client_id: A };
  memberships = [A];
});

describe("requireClientWorkspace (S3) — loop-safe resolution", () => {
  it("client with ONE membership resolves it (no redirect)", async () => {
    const ctx = await requireClientWorkspace();
    expect(ctx.clientId).toBe(A);
    expect(ctx.hasMultiple).toBe(false);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("ZERO memberships → stable /no-access (never /login → no loop)", async () => {
    memberships = [];
    const dest = await callExpectingRedirect();
    expect(dest).toBe("/no-access");
  });

  it("revoked-final state (client_id set but no memberships) → /no-access, not a loop", async () => {
    // profiles.client_id may still point somewhere, but authorization is
    // membership: with none, we must NOT resolve it and must NOT bounce to /login.
    profile = { id: "u1", role: "client", client_id: A };
    memberships = [];
    expect(await callExpectingRedirect()).toBe("/no-access");
  });

  it("multi-membership honours a valid stored active-workspace cookie", async () => {
    memberships = [A, B];
    cookieValue = B;
    const ctx = await requireClientWorkspace();
    expect(ctx.clientId).toBe(B);
    expect(ctx.hasMultiple).toBe(true);
  });

  it("multi-membership with a null legacy default still resolves (deterministic)", async () => {
    profile = { id: "u1", role: "client", client_id: null };
    memberships = [B, A];
    const ctx = await requireClientWorkspace();
    expect(ctx.clientId).toBe(A); // lowest id fallback
  });

  it("an admin is routed to their own home, never the client no-access path", async () => {
    profile = { id: "admin1", role: "admin", client_id: null };
    memberships = [];
    expect(await callExpectingRedirect()).toBe("/admin");
  });
});
