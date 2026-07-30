import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolate the action: mock the session client, auth, flag, and the reconciliation
// service so we can assert the control flow (RPC → then reconcile, only on success).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-uid", role: "admin" })),
}));
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/planner/scheduling/service", () => ({
  reconcileMeeting: vi.fn(async () => ({ result: "success" })),
}));

import { deleteMeetingAction } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { isPlannerEnabled } from "@/lib/flags";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";

const MID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlannerEnabled).mockReturnValue(true);
});

describe("deleteMeetingAction", () => {
  it("soft-deletes via the RPC, then reconciles — projection runs ONLY after success", async () => {
    const rpc = vi.fn(async () => ({ data: MID, error: null }));
    vi.mocked(createClient).mockResolvedValue(
      { rpc } as unknown as Awaited<ReturnType<typeof createClient>>
    );

    const res = await deleteMeetingAction(MID);

    expect(rpc).toHaveBeenCalledWith("soft_delete_meeting", { p_meeting_id: MID });
    expect(res).toEqual({ ok: true, id: MID });
    expect(reconcileMeeting).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileMeeting).mock.calls[0][0]).toBe(MID);
  });

  it("a failed RPC surfaces an error and does NOT report success or reconcile", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "not authorized", code: "42501" },
    }));
    vi.mocked(createClient).mockResolvedValue(
      { rpc } as unknown as Awaited<ReturnType<typeof createClient>>
    );

    const res = await deleteMeetingAction(MID);

    expect(res).toEqual({ error: "not authorized" });
    expect(res.ok).toBeUndefined();
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });

  it("does nothing (and never opens a client) when the Planner flag is off", async () => {
    vi.mocked(isPlannerEnabled).mockReturnValue(false);
    const res = await deleteMeetingAction(MID);
    expect(res.error).toMatch(/not enabled/i);
    expect(createClient).not.toHaveBeenCalled();
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});
