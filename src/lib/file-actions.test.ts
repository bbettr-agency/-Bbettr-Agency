import { describe, it, expect, beforeEach, vi } from "vitest";

// recordFileUploadActivity must authorize by MEMBERSHIP (client_members), not the
// legacy profiles.client_id — so a member of a non-default workspace is allowed,
// and a non-member is blocked (it writes via the service-role logActivity, which
// bypasses RLS, so this is the authoritative gate). It must never throw.

let profile: { role: string; client_id: string | null } | null = null;
let membershipRow: { client_id: string } | null = null;
const logActivity = vi.fn(async (_arg: unknown) => {});

vi.mock("@/lib/auth", () => ({ getCurrentProfile: async () => profile }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: unknown) => logActivity(a) }));
vi.mock("@/lib/assets", () => ({ categoryLabel: (c: string) => c }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: membershipRow }) }) }) }),
  }),
}));

import { recordFileUploadActivity } from "./file-actions";

beforeEach(() => {
  vi.clearAllMocks();
  profile = null;
  membershipRow = null;
});

describe("recordFileUploadActivity — membership-gated", () => {
  it("admin → logs regardless of membership", async () => {
    profile = { role: "admin", client_id: null };
    await recordFileUploadActivity("B", "f.png", "media");
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it("client who IS a member of the (non-default) workspace → logs", async () => {
    // legacy default is A, active workspace is B, and they ARE a member of B.
    profile = { role: "client", client_id: "A" };
    membershipRow = { client_id: "B" };
    await recordFileUploadActivity("B", "f.png", "media");
    expect(logActivity).toHaveBeenCalledTimes(1);
    const arg = logActivity.mock.calls[0]?.[0] as { clientId: string };
    expect(arg.clientId).toBe("B");
  });

  it("client who is NOT a member → does NOT log (fails closed, no cross-tenant write)", async () => {
    profile = { role: "client", client_id: "A" };
    membershipRow = null; // RLS returns no row → not a member of the target
    await recordFileUploadActivity("C", "f.png", "media");
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("no authenticated profile → does nothing, never throws", async () => {
    profile = null;
    await expect(recordFileUploadActivity("B", "f.png", "media")).resolves.toBeUndefined();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
