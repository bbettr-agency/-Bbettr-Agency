/**
 * Pure presentation model for the client Home "What we still need from you"
 * card (Slice 2C) — no I/O, no JSX, so the progressive behaviour is testable.
 *
 * The underlying readiness data (readiness.ts) is unchanged; this only decides
 * how much of it to show, so a near-complete checklist stops occupying a big
 * card on Home:
 *   hidden   — no trackable requirements, or admin has confirmed assets received
 *   complete — the client has provided everything (compact success line)
 *   compact  — only a few items remain → a one-line summary + expandable detail
 *   full     — many items remain → the full checklist is worth showing
 */
export type ReadinessMode = "hidden" | "complete" | "compact" | "full";

/** At or below this many outstanding items, collapse to the compact summary. */
export const READINESS_COMPACT_MAX = 3;

export interface ReadinessSummaryInput {
  hasItems: boolean;
  totalItems: number;
  totalDone: number;
  allReady: boolean;
  /** Admin has marked the "Assets Received" stage complete. */
  assetsReceived: boolean;
}

export function readinessSummary(
  i: ReadinessSummaryInput
): { mode: ReadinessMode; pending: number } {
  if (!i.hasItems || i.assetsReceived) return { mode: "hidden", pending: 0 };
  const pending = Math.max(0, i.totalItems - i.totalDone);
  if (pending === 0 || i.allReady) return { mode: "complete", pending: 0 };
  if (pending <= READINESS_COMPACT_MAX) return { mode: "compact", pending };
  return { mode: "full", pending };
}
