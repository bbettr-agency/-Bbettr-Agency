import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin", role: "admin" })) }));
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(() => true) }));
vi.mock("@/lib/net", () => ({ newCorrelationId: () => "cid" }));
vi.mock("@/lib/planner/scheduling/service", () => ({
  reconciliationScheduler: { tick: vi.fn() },
  rebuildCalendar: vi.fn(),
  reconcileMeetingManually: vi.fn(),
}));

import { retryMeetingSyncAction } from "./actions";
import { reconcileMeetingManually } from "@/lib/planner/scheduling/service";
import { isPlannerEnabled } from "@/lib/flags";

const MID = "mtg-1";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlannerEnabled).mockReturnValue(true);
});

describe("retryMeetingSyncAction — reconciles ONE meeting, honest outcome", () => {
  it("blocks when Planner is disabled (no reconcile)", async () => {
    vi.mocked(isPlannerEnabled).mockReturnValue(false);
    const res = await retryMeetingSyncAction(MID);
    expect(res.error).toMatch(/not enabled/i);
    expect(reconcileMeetingManually).not.toHaveBeenCalled();
  });

  it("rejects a missing id", async () => {
    const res = await retryMeetingSyncAction("");
    expect(res.error).toMatch(/missing meeting id/i);
    expect(reconcileMeetingManually).not.toHaveBeenCalled();
  });

  it("passes ONLY this meeting id to the engine", async () => {
    vi.mocked(reconcileMeetingManually).mockResolvedValue({ result: "success", operation: "update", meetPending: false } as never);
    await retryMeetingSyncAction(MID);
    expect(reconcileMeetingManually).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileMeetingManually).mock.calls[0][0]).toBe(MID);
  });

  it("maps success → synced / meet_pending honestly", async () => {
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "success", operation: "create", meetPending: false } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("synced");
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "success", operation: "create", meetPending: true } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("meet_pending");
  });

  it("maps failure → failed / disconnected honestly", async () => {
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "failure", reason: "boom", disconnected: false } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("failed");
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "failure", reason: "invalid_grant", disconnected: true } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("disconnected");
  });

  it("maps skipped (not configured) → skipped", async () => {
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "skipped", reason: "not_configured" } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("skipped");
  });

  it("maps a contended single-flight lock (skipped:locked) → busy, NOT 'not connected'", async () => {
    vi.mocked(reconcileMeetingManually).mockResolvedValueOnce({ result: "skipped", reason: "locked" } as never);
    expect((await retryMeetingSyncAction(MID)).state).toBe("busy");
  });
});
