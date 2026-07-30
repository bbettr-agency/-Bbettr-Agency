import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Replace the connection module so its server-only/admin imports never run.
vi.mock("@/lib/google/connection", () => ({ getAccessToken: vi.fn() }));

import { getAccessToken } from "@/lib/google/connection";
import { getCachedAccessToken, invalidateAccessTokenCache } from "./token-cache";

const mockGet = vi.mocked(getAccessToken);

beforeEach(() => {
  invalidateAccessTokenCache();
  mockGet.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("getCachedAccessToken", () => {
  it("mints once and reuses the token while valid", async () => {
    mockGet.mockResolvedValue({ accessToken: "t1", expiresInSec: 3600 });
    expect(await getCachedAccessToken()).toBe("t1");
    expect(await getCachedAccessToken()).toBe("t1");
    expect(await getCachedAccessToken()).toBe("t1");
    expect(mockGet).toHaveBeenCalledTimes(1); // reused, no extra refresh
  });

  it("refreshes only within the 5-minute safety window of expiry", async () => {
    mockGet
      .mockResolvedValueOnce({ accessToken: "t1", expiresInSec: 3600 })
      .mockResolvedValueOnce({ accessToken: "t2", expiresInSec: 3600 });

    await getCachedAccessToken(); // t=0, expires at 3_600_000

    // 1ms before the skew boundary → still cached.
    vi.setSystemTime(3_600_000 - 5 * 60_000 - 1);
    expect(await getCachedAccessToken()).toBe("t1");
    expect(mockGet).toHaveBeenCalledTimes(1);

    // At the skew boundary → refresh.
    vi.setSystemTime(3_600_000 - 5 * 60_000);
    expect(await getCachedAccessToken()).toBe("t2");
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("invalidation forces the next call to refresh", async () => {
    mockGet
      .mockResolvedValueOnce({ accessToken: "t1", expiresInSec: 3600 })
      .mockResolvedValueOnce({ accessToken: "t2", expiresInSec: 3600 });
    expect(await getCachedAccessToken()).toBe("t1");
    invalidateAccessTokenCache();
    expect(await getCachedAccessToken()).toBe("t2");
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
