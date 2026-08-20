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

/**
 * Every distinct capability that existed across the 9 legacy sections, mapped to
 * the primary section that now owns it. This is the orphan guard: the 9→4
 * collapse must not drop any manager/action. Tested exhaustively so a future
 * refactor that silently loses a surface fails CI.
 */
export const CAPABILITY_SECTION: Record<string, SectionId> = {
  // Command Centre — identity & access
  contact: "command-centre",
  "account-services": "command-centre",
  "portal-access": "command-centre",
  // Work — delivery, communication, and occasional/legacy context
  readiness: "work",
  roadmap: "work",
  activity: "work",
  "post-update": "work",
  "request-action": "work",
  "update-questions": "work",
  "update-history": "work",
  "project-settings": "work",
  "onboarding-answers": "work",
  intake: "work",
  // Money — client billing only (NOT the global rep Invoice Requests)
  "billing-details": "money",
  billing: "money",
  // Documents — one destination, three tabs
  contracts: "documents",
  files: "documents",
  reports: "documents",
  "report-authoring": "documents",
};

/**
 * Documents is one destination with an internal segmented control rather than
 * three stacked cards. Order IS the tab order; `files` is the everyday default.
 */
export type DocTab = "files" | "contracts" | "reports";
export const DOC_TABS: readonly DocTab[] = ["files", "contracts", "reports"];
