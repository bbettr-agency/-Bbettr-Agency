/**
 * Pure client-workspace section model (no JSX) so the routing/alias logic is
 * unit-testable in isolation. IA Slice 1: the 9 legacy sections are reorganised
 * into 4 primary destinations; every legacy capability is preserved (see
 * client-detail.tsx for the content mapping).
 */

export type SectionId = "command-centre" | "work" | "money" | "documents";

export const SECTION_IDS: readonly SectionId[] = [
  "command-centre",
  "work",
  "money",
  "documents",
];

/** Legacy ?section= values → new sections, so old bookmarks still land correctly. */
const LEGACY_ALIAS: Record<string, SectionId> = {
  overview: "command-centre",
  intake: "work",
  onboarding: "work",
  progress: "work",
  updates: "work",
  billing: "money",
  contracts: "documents",
  files: "documents",
  reports: "documents",
};

/** Resolve a raw ?section= value to a current section id. Default: command-centre. */
export function resolveSection(raw: string | null): SectionId {
  if (raw && (SECTION_IDS as readonly string[]).includes(raw)) return raw as SectionId;
  if (raw && LEGACY_ALIAS[raw]) return LEGACY_ALIAS[raw];
  return "command-centre";
}
