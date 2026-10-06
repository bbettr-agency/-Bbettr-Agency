import { estimateTokens } from "./serialize";

/**
 * Jarvis Retrieval V2 — token/cost budget (PURE). Concrete locked numbers.
 * Pass A (domain coverage) is a guaranteed floor; Pass B detail is allocated up to
 * the evidence ceiling; when the whole prompt would exceed its ceiling, HISTORY is
 * reduced first — current authoritative Portal evidence is never trimmed for history.
 */
export const BUDGET = {
  EVIDENCE_TARGET: 6000,
  EVIDENCE_HARD: 10000,
  PROMPT_INPUT_HARD: 16000,
  PASS_A_CAP: 2500,
  MEMORY_TARGET: 1200,
  MEMORY_HARD: 1500,
  HISTORY_TARGET: 2500,
  HISTORY_FLOOR: 500,
  OUTPUT_TOKENS: 1500,
} as const;

/** Detail budget range for Pass B given Pass-A and memory already spent. Aims for
 *  the normal target and expands toward the hard ceiling only when detail exists. */
export function detailBudgetRange(passATokens: number, memoryTokens: number): { target: number; hard: number } {
  return {
    target: Math.max(0, BUDGET.EVIDENCE_TARGET - passATokens - memoryTokens),
    hard: Math.max(0, BUDGET.EVIDENCE_HARD - passATokens - memoryTokens),
  };
}

/**
 * Trim conversation history (oldest-first) to fit under the prompt ceiling, keeping
 * at least the most recent message. History yields BEFORE evidence.
 */
export function fitHistory(args: {
  fixedTokens: number;
  evidenceTokens: number;
  historyTexts: string[]; // chronological (oldest first)
}): { keptCount: number; keptTokens: number; reducedFromTarget: boolean } {
  const costs = args.historyTexts.map(estimateTokens);
  let start = 0;
  const total = () => costs.slice(start).reduce((a, b) => a + b, 0);
  // 1) cap history to its target
  while (start < costs.length - 1 && total() > BUDGET.HISTORY_TARGET) start++;
  // 2) fit the overall prompt ceiling (history yields further, keep >= 1 message)
  while (start < costs.length - 1 && args.fixedTokens + args.evidenceTokens + total() > BUDGET.PROMPT_INPUT_HARD) start++;
  return { keptCount: costs.length - start, keptTokens: total(), reducedFromTarget: start > 0 };
}
