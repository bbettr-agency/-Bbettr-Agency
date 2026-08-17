import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolate the READ helper from the network + config. withRetry is pass-through.
vi.mock("@/lib/net", () => ({
  fetchJsonWithTimeout: vi.fn(),
  withRetry: (fn: () => unknown) => fn(),
  IntegrationConfigError: class IntegrationConfigError extends Error {
    integration: string;
    constructor(integration: string, message: string) {
      super(message);
      this.integration = integration;
    }
  },
}));
vi.mock("@/lib/google/config", () => ({ getGoogleConfig: vi.fn() }));
vi.mock("./token-cache", () => ({ getCachedAccessToken: vi.fn(async () => "access-token") }));

import { listBusyIntervals } from "./availability";
import { fetchJsonWithTimeout } from "@/lib/net";
import { getGoogleConfig } from "@/lib/google/config";

const WINDOW = { timeMinIso: "2026-08-17T07:00:00.000Z", timeMaxIso: "2026-08-28T15:00:00.000Z", tz: "Africa/Johannesburg" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGoogleConfig).mockReturnValue({ calendarId: "agency@bbettr" } as never);
});

describe("listBusyIntervals", () => {
  it("throws when Google is not configured (caller fails closed)", async () => {
    vi.mocked(getGoogleConfig).mockReturnValue(null);
    await expect(listBusyIntervals(WINDOW)).rejects.toThrow();
    expect(fetchJsonWithTimeout).not.toHaveBeenCalled();
  });

  it("counts a timed event as busy but ignores cancelled and transparent (free) events", async () => {
    vi.mocked(fetchJsonWithTimeout).mockResolvedValueOnce({
      items: [
        { status: "confirmed", start: { dateTime: "2026-08-17T09:00:00Z" }, end: { dateTime: "2026-08-17T10:00:00Z" } },
        { status: "cancelled", start: { dateTime: "2026-08-17T11:00:00Z" }, end: { dateTime: "2026-08-17T12:00:00Z" } },
        { transparency: "transparent", start: { dateTime: "2026-08-17T13:00:00Z" }, end: { dateTime: "2026-08-17T14:00:00Z" } },
      ],
    } as never);
    const busy = await listBusyIntervals(WINDOW);
    expect(busy).toEqual([{ startsAt: "2026-08-17T09:00:00.000Z", endsAt: "2026-08-17T10:00:00.000Z" }]);
  });

  it("requests singleEvents=true / orderBy=startTime / showDeleted=false (recurrences pre-expanded)", async () => {
    vi.mocked(fetchJsonWithTimeout).mockResolvedValueOnce({ items: [] } as never);
    await listBusyIntervals(WINDOW);
    const url = vi.mocked(fetchJsonWithTimeout).mock.calls[0][0] as string;
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(url).toContain("showDeleted=false");
    expect(url).toContain(encodeURIComponent("agency@bbettr"));
  });

  it("follows nextPageToken across pages", async () => {
    vi.mocked(fetchJsonWithTimeout)
      .mockResolvedValueOnce({
        items: [{ status: "confirmed", start: { dateTime: "2026-08-17T09:00:00Z" }, end: { dateTime: "2026-08-17T10:00:00Z" } }],
        nextPageToken: "PAGE2",
      } as never)
      .mockResolvedValueOnce({
        items: [{ status: "confirmed", start: { dateTime: "2026-08-18T09:00:00Z" }, end: { dateTime: "2026-08-18T10:00:00Z" } }],
      } as never);
    const busy = await listBusyIntervals(WINDOW);
    expect(busy).toHaveLength(2);
    expect(fetchJsonWithTimeout).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchJsonWithTimeout).mock.calls[1][0] as string).toContain("pageToken=PAGE2");
  });

  it("treats an all-day event as busy for the whole local day (zone-aware boundaries)", async () => {
    vi.mocked(fetchJsonWithTimeout).mockResolvedValueOnce({
      items: [{ status: "confirmed", start: { date: "2026-08-20" }, end: { date: "2026-08-21" } }],
    } as never);
    const busy = await listBusyIntervals(WINDOW);
    // 00:00 SAST (UTC+2) on 20 Aug = 19 Aug 22:00Z; exclusive end = 20 Aug 22:00Z.
    expect(busy).toEqual([{ startsAt: "2026-08-19T22:00:00.000Z", endsAt: "2026-08-20T22:00:00.000Z" }]);
  });

  it("propagates an API failure (caller fails closed — never silently empty)", async () => {
    vi.mocked(fetchJsonWithTimeout).mockRejectedValueOnce(new Error("google API 500"));
    await expect(listBusyIntervals(WINDOW)).rejects.toThrow(/500/);
  });
});
