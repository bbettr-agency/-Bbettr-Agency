/**
 * Pure prospect-intake section model + progress helpers (P2-A) — no I/O, no JSX.
 *
 * The journey is a FIXED six-section structure. The denominator never changes:
 * selecting "I'm not sure yet" simply causes section 3 ("A few details") to be
 * skipped during navigation — the section indices (and "N of 6") stay stable so
 * the flow never feels structurally unstable.
 *
 *   1 Your business   2 What we can help with   3 A few details
 *   4 Your goals      5 Budget & timing         6 Review
 */
export type IntakeSectionId =
  | "business"
  | "services"
  | "details"
  | "goals"
  | "budget"
  | "review";

export interface IntakeSection {
  id: IntakeSectionId;
  /** Fixed 1-based section number (the visible denominator is always 6). */
  index: number;
  label: string;
}

export const INTAKE_SECTIONS: readonly IntakeSection[] = [
  { id: "business", index: 1, label: "Your business" },
  { id: "services", index: 2, label: "What we can help with" },
  { id: "details", index: 3, label: "A few details" },
  { id: "goals", index: 4, label: "Your goals" },
  { id: "budget", index: 5, label: "Budget & timing" },
  { id: "review", index: 6, label: "Review" },
];

export const INTAKE_SECTION_COUNT = INTAKE_SECTIONS.length; // always 6

const ORDER: IntakeSectionId[] = INTAKE_SECTIONS.map((s) => s.id);

/** Section 3 is skipped only when the prospect said they're not sure yet. */
function isSkipped(id: IntakeSectionId, servicesUncertain: boolean): boolean {
  return id === "details" && servicesUncertain;
}

export function getSection(id: IntakeSectionId): IntakeSection {
  return INTAKE_SECTIONS.find((s) => s.id === id)!;
}

/** The next section after `current`, skipping "details" when uncertain. Null at the end. */
export function nextSection(
  current: IntakeSectionId,
  opts: { servicesUncertain: boolean }
): IntakeSectionId | null {
  for (let i = ORDER.indexOf(current) + 1; i < ORDER.length; i++) {
    if (!isSkipped(ORDER[i], opts.servicesUncertain)) return ORDER[i];
  }
  return null;
}

/** The previous section before `current`, skipping "details" when uncertain. Null at the start. */
export function prevSection(
  current: IntakeSectionId,
  opts: { servicesUncertain: boolean }
): IntakeSectionId | null {
  for (let i = ORDER.indexOf(current) - 1; i >= 0; i--) {
    if (!isSkipped(ORDER[i], opts.servicesUncertain)) return ORDER[i];
  }
  return null;
}

export interface ProgressView {
  /** Fixed section number (1..6). */
  index: number;
  /** Always 6 — the denominator is stable. */
  count: number;
  label: string;
  /** 0..1 completion fraction for the bar (index / count). */
  fraction: number;
}

/** Progress descriptor for a section — stable denominator, no shrinking arithmetic. */
export function progressFor(id: IntakeSectionId): ProgressView {
  const s = getSection(id);
  return {
    index: s.index,
    count: INTAKE_SECTION_COUNT,
    label: s.label,
    fraction: s.index / INTAKE_SECTION_COUNT,
  };
}
