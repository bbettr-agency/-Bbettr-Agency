import { describe, it, expect, beforeEach, vi } from "vitest";

// reconcileMeetingManually: the per-meeting "Retry sync" engine entry. Must honour
// the Google-config gate and only PROJECT the one existing meeting (never insert a
// Portal meeting; the deterministic-id engine guarantees same-event, no dupes).
vi.mock("@/lib/google", () => ({
  isGoogleConfigured: vi.fn(() => true),
  createGoogleCalendarProvider: vi.fn(() => ({})),
}));
vi.mock("./reconcile", () => ({
  projectEntity: vi.fn(async () => ({ result: "success", operation: "update", meetPending: false })),
}));
// Keep buildDeps' other collaborators inert.
vi.mock("./supabase-store", () => ({ createSupabaseProjectionStore: vi.fn(() => ({})) }));
vi.mock("@/lib/planner/meetings/desired-provider", () => ({ createMeetingDesiredStateProvider: vi.fn(() => ({})) }));
vi.mock("./sync-log", () => ({ productionSyncLogger: vi.fn() }));

import { reconcileMeetingManually } from "./service";
import { isGoogleConfigured } from "@/lib/google";
import { projectEntity } from "./reconcile";

const MID = "mtg-123";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isGoogleConfigured).mockReturnValue(true);
});

describe("reconcileMeetingManually", () => {
  it("SKIPS (never bypasses config) when Google is not configured — no projection call", async () => {
    vi.mocked(isGoogleConfigured).mockReturnValue(false);
    const res = await reconcileMeetingManually(MID);
    expect(res).toEqual({ result: "skipped", reason: "not_configured" });
    expect(projectEntity).not.toHaveBeenCalled();
  });

  it("projects EXACTLY this one meeting (entityType=meeting, the given id) — no Portal insert", async () => {
    const res = await reconcileMeetingManually(MID);
    expect(res.result).toBe("success");
    expect(projectEntity).toHaveBeenCalledTimes(1);
    const ref = vi.mocked(projectEntity).mock.calls[0][1];
    expect(ref).toEqual({ entityType: "meeting", entityId: MID });
    // The engine only projects the existing row; the manual entry does no DB writes itself.
  });
});
