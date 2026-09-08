/**
 * Pure interactive-flow logic for the public intake (P2-D) — no I/O, no JSX.
 *
 * All of the flow's DECISIONS live here so they can be unit-tested in node
 * without a DOM: section navigation (including the service-detail mini-panel
 * sequence and the "unsure skips Details" rule), the per-section validation
 * gate, the create/save/submit guards that prevent duplicate writes, whether a
 * confirmed save must land before advancing, mapping a server result kind to a
 * UX outcome, and where a Review "Edit" jumps. The React component
 * (intake-flow.tsx) is a thin shell that renders state and calls these.
 *
 * The six-section denominator is fixed (see intake-steps.ts); Details is a
 * single section that internally steps through one mini-panel per selected
 * service — that internal stepping never changes the "N of 6" denominator.
 */
import type { ServiceType } from "@/lib/database.types";
import {
  type IntakeSectionId,
  nextSection,
  prevSection,
} from "./intake-steps";
import { normalizeServiceSelection } from "./intake-lifecycle";
import { SERVICES_UNCERTAIN_KEY, SELECTED_SERVICES_KEY } from "./intake-schema";
import {
  validateBusiness,
  validateServices,
  validateDetails,
  validateGoals,
  validateBudget,
  validateForSubmit,
  type ValidationResult,
} from "./intake-validation";

function rec(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** The selected services, in catalog order — one Details mini-panel each. */
export function serviceDetailPanels(data: unknown): ServiceType[] {
  const d = rec(data);
  return normalizeServiceSelection(
    Array.isArray(d[SELECTED_SERVICES_KEY]) ? (d[SELECTED_SERVICES_KEY] as string[]) : []
  );
}

function isUncertain(data: unknown): boolean {
  return rec(data)[SERVICES_UNCERTAIN_KEY] === true;
}

// ── Per-section validation gate (mirrors the server; forgiving on optionals) ──
export function validateSection(section: IntakeSectionId, data: unknown): ValidationResult {
  const d = rec(data);
  switch (section) {
    case "business":
      return validateBusiness(d);
    case "services":
      return validateServices(d);
    case "details":
      return validateDetails(d);
    case "goals":
      return validateGoals(d);
    case "budget":
      return validateBudget(d);
    case "review":
      return validateForSubmit(d);
  }
}

export function canAdvanceFrom(section: IntakeSectionId, data: unknown): boolean {
  return validateSection(section, data).ok;
}

// ── Navigation (section + internal Details panel) ────────────────────────────
export interface Nav {
  section: IntakeSectionId;
  /** Active Details mini-panel index (0 outside Details). */
  panel: number;
  /** True when the current section is Review and forward means SUBMIT (async). */
  submit?: boolean;
}

/** Where a fresh generic journey begins after the intro. */
export const FIRST_SECTION: IntakeSectionId = "business";

/** Forward move from (section, panel) given the current data. */
export function advance(section: IntakeSectionId, panel: number, data: unknown): Nav {
  const uncertain = isUncertain(data);

  if (section === "details") {
    const panels = serviceDetailPanels(data);
    if (panel < panels.length - 1) return { section: "details", panel: panel + 1 };
    const after = nextSection("details", { servicesUncertain: uncertain }) ?? "goals";
    return { section: after, panel: 0 };
  }

  if (section === "review") return { section: "review", panel: 0, submit: true };

  const next = nextSection(section, { servicesUncertain: uncertain });
  if (next === null) return { section, panel: 0 };
  if (next === "details") {
    if (serviceDetailPanels(data).length === 0) {
      const after = nextSection("details", { servicesUncertain: uncertain }) ?? "goals";
      return { section: after, panel: 0 };
    }
    return { section: "details", panel: 0 };
  }
  return { section: next, panel: 0 };
}

/** Backward move. Null means "already at the first section" (show intro/exit). */
export function back(section: IntakeSectionId, panel: number, data: unknown): Nav | null {
  const uncertain = isUncertain(data);

  if (section === "details") {
    if (panel > 0) return { section: "details", panel: panel - 1 };
    return { section: "services", panel: 0 };
  }

  const prev = prevSection(section, { servicesUncertain: uncertain });
  if (prev === null) return null;
  if (prev === "details") {
    const panels = serviceDetailPanels(data);
    if (panels.length === 0) {
      const before = prevSection("details", { servicesUncertain: uncertain }) ?? "services";
      return { section: before, panel: 0 };
    }
    return { section: "details", panel: panels.length - 1 };
  }
  return { section: prev, panel: 0 };
}

/** Review "Edit" jump target (Details always enters at its first mini-panel). */
export function editTarget(section: IntakeSectionId): Nav {
  return { section, panel: 0 };
}

// ── Write guards (prevent duplicate drafts / double-submit) ──────────────────
export function canCreateDraft(s: { creating: boolean; token: string | null }): boolean {
  return !s.creating && s.token === null;
}
export function canSubmitNow(s: { submitting: boolean; token: string | null }): boolean {
  return !s.submitting && s.token !== null;
}
/**
 * A section advance is allowed only once any in-flight autosave has confirmed.
 * "saving" (a confirmed save is still pending) and "error" (the last save
 * failed) both block; "idle" (nothing dirty) and "saved" both allow.
 */
export function canProceed(saveStatus: SaveStatus): boolean {
  return saveStatus === "idle" || saveStatus === "saved";
}

// ── Server-result classification (kind → UX outcome) ─────────────────────────
export type ActionOutcome =
  | "success"
  | "already_submitted"
  | "validation"
  | "verification"
  | "config"
  | "conflict"
  | "expired"
  | "closed"
  | "save_failed";

export function classifyKind(kind: string): ActionOutcome {
  switch (kind) {
    case "success":
      return "success";
    case "already_submitted":
      return "already_submitted";
    case "validation_error":
      return "validation";
    case "verification_failed":
      return "verification";
    case "configuration_error":
      return "config";
    case "conflict":
      return "conflict";
    case "expired":
      return "expired";
    case "invalid_or_closed":
      return "closed";
    case "save_failed":
      return "save_failed";
    default:
      return "save_failed";
  }
}

/** Outcomes that mean the link is permanently closed → switch to a closed view. */
export function isClosedOutcome(o: ActionOutcome): boolean {
  return o === "expired" || o === "closed";
}
/** Outcomes that are safe to retry without losing entered values. */
export function isRetryableOutcome(o: ActionOutcome): boolean {
  return o === "verification" || o === "config" || o === "conflict" || o === "save_failed";
}
