import { describe, it, expect } from "vitest";
import {
  readinessSummary,
  READINESS_COMPACT_MAX,
  type ReadinessSummaryInput,
} from "./readiness-summary";

const base: ReadinessSummaryInput = {
  hasItems: true,
  totalItems: 8,
  totalDone: 0,
  allReady: false,
  assetsReceived: false,
};

describe("readinessSummary — progressive Home behaviour", () => {
  it("is hidden when there are no trackable requirements", () => {
    expect(readinessSummary({ ...base, hasItems: false }).mode).toBe("hidden");
  });

  it("is hidden once the admin has confirmed assets received", () => {
    expect(readinessSummary({ ...base, assetsReceived: true }).mode).toBe("hidden");
  });

  it("is complete when everything is provided (allReady)", () => {
    const r = readinessSummary({ ...base, totalDone: 8, allReady: true });
    expect(r.mode).toBe("complete");
    expect(r.pending).toBe(0);
  });

  it("is complete when nothing is pending even if allReady flag lags", () => {
    expect(readinessSummary({ ...base, totalItems: 4, totalDone: 4 }).mode).toBe("complete");
  });

  it("is compact when only a few items remain (1..MAX)", () => {
    for (let pending = 1; pending <= READINESS_COMPACT_MAX; pending++) {
      const r = readinessSummary({ ...base, totalItems: 8, totalDone: 8 - pending });
      expect(r.mode).toBe("compact");
      expect(r.pending).toBe(pending);
    }
  });

  it("is full when many items remain (> MAX)", () => {
    const r = readinessSummary({ ...base, totalItems: 8, totalDone: 8 - (READINESS_COMPACT_MAX + 1) });
    expect(r.mode).toBe("full");
    expect(r.pending).toBe(READINESS_COMPACT_MAX + 1);
  });

  it("never reports negative pending", () => {
    expect(readinessSummary({ ...base, totalItems: 2, totalDone: 5 }).pending).toBe(0);
  });
});
