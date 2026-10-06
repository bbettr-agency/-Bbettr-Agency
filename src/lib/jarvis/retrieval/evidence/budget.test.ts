import { describe, it, expect } from "vitest";
import { fitHistory, detailBudgetRange, BUDGET } from "./budget";

describe("fitHistory — history yields before authoritative evidence", () => {
  it("keeps everything when it comfortably fits", () => {
    const r = fitHistory({ fixedTokens: 1000, evidenceTokens: 2000, historyTexts: ["hi", "there"] });
    expect(r.keptCount).toBe(2);
    expect(r.reducedFromTarget).toBe(false);
  });

  it("drops oldest history first when evidence is large, keeping >= 1 message", () => {
    const big = "x".repeat(4000); // ~1000 tokens each
    const history = [big, big, big, big, big, big, big, big, big, big]; // ~10k tokens
    const r = fitHistory({ fixedTokens: 2500, evidenceTokens: BUDGET.EVIDENCE_HARD, historyTexts: history });
    expect(r.reducedFromTarget).toBe(true);
    expect(r.keptCount).toBeGreaterThanOrEqual(1);
    expect(r.keptCount).toBeLessThan(history.length);
    // the prompt now fits under the hard ceiling
    expect(2500 + BUDGET.EVIDENCE_HARD + r.keptTokens).toBeLessThanOrEqual(BUDGET.PROMPT_INPUT_HARD + 1000);
  });

  it("caps history to its target even when the overall prompt is small", () => {
    const chunk = "y".repeat(4000); // ~1000 tokens
    const r = fitHistory({ fixedTokens: 100, evidenceTokens: 100, historyTexts: [chunk, chunk, chunk, chunk] });
    expect(r.keptTokens).toBeLessThanOrEqual(BUDGET.HISTORY_TARGET);
  });
});

describe("detailBudgetRange", () => {
  it("targets ~6k and expands to 10k hard, net of Pass-A + memory", () => {
    const r = detailBudgetRange(2000, 1200);
    expect(r.target).toBe(BUDGET.EVIDENCE_TARGET - 2000 - 1200);
    expect(r.hard).toBe(BUDGET.EVIDENCE_HARD - 2000 - 1200);
  });
  it("never negative", () => {
    const r = detailBudgetRange(9000, 1500);
    expect(r.target).toBe(0);
    expect(r.hard).toBeGreaterThanOrEqual(0);
  });
});
