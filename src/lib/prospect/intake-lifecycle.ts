/**
 * Pure prospect-intake lifecycle + token-capability model (P1) — no I/O, no JSX.
 *
 * Lifecycle:
 *   draft ──submit──▶ submitted ──convert──▶ converted   (terminal)
 *     │                   │
 *     └──dismiss──┐   ┌───┴──dismiss──▶ dismissed        (terminal)
 *                 ▼   ▼
 *              (admin dismiss from draft or submitted)
 *   An admin may also convert directly from draft (a prefilled personalised
 *   intake the admin completed). converted/dismissed are terminal.
 *
 * Token invalidation semantics are explicit (locked):
 *   • draft (live)      → readable AND mutable (resumable autosave)
 *   • submitted (live)  → readable, NOT mutable (no silent edits after submit)
 *   • converted         → not readable, not mutable (link closed)
 *   • dismissed         → not readable, not mutable (link closed)
 *   • expired           → not readable, not mutable (any non-terminal state)
 */
import type { ServiceType } from "@/lib/database.types";

export type ProspectIntakeStatus = "draft" | "submitted" | "converted" | "dismissed";
export type ProspectSource = "generic" | "personalised";

export const PROSPECT_INTAKE_STATUSES: readonly ProspectIntakeStatus[] = [
  "draft",
  "submitted",
  "converted",
  "dismissed",
];

/** Terminal states allow no further transition and close the token entirely. */
export function isTerminalStatus(status: ProspectIntakeStatus): boolean {
  return status === "converted" || status === "dismissed";
}

/** Allowed lifecycle transitions (admin/system-driven). */
const TRANSITIONS: Record<ProspectIntakeStatus, readonly ProspectIntakeStatus[]> = {
  draft: ["submitted", "converted", "dismissed"],
  submitted: ["converted", "dismissed"],
  converted: [],
  dismissed: [],
};

export function canTransition(
  from: ProspectIntakeStatus,
  to: ProspectIntakeStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

// ── Token capability by state + expiry ──────────────────────────────────────

export interface TokenCapability {
  canRead: boolean;
  canMutate: boolean;
}

/**
 * What the presented (already hash-matched) token permits, given the row's
 * lifecycle state and whether it has expired. Fail-closed: an expired or
 * terminal intake permits nothing.
 */
export function tokenCapability(
  status: ProspectIntakeStatus,
  expired: boolean
): TokenCapability {
  if (isTerminalStatus(status)) return { canRead: false, canMutate: false };
  if (expired) return { canRead: false, canMutate: false };
  if (status === "submitted") return { canRead: true, canMutate: false };
  // draft, live
  return { canRead: true, canMutate: true };
}

/** A prospect may submit only a live draft. */
export function canSubmit(status: ProspectIntakeStatus, expired: boolean): boolean {
  return status === "draft" && !expired;
}

// ── Conversion idempotency primitives (used by P4, defined now) ─────────────

export interface ConvertibleIntake {
  status: ProspectIntakeStatus;
  convertedClientId: string | null;
}

/**
 * A prospect is convertible only from a non-terminal state AND when it has not
 * already produced a client. Both guards together ensure repeated conversion
 * requests can never create a second client.
 */
export function canConvert(intake: ConvertibleIntake): boolean {
  if (intake.convertedClientId != null) return false;
  return intake.status === "draft" || intake.status === "submitted";
}

/** True once a prospect has produced a client (the idempotency sentinel). */
export function isAlreadyConverted(intake: ConvertibleIntake): boolean {
  return intake.status === "converted" || intake.convertedClientId != null;
}

// ── Service selection ────────────────────────────────────────────────────────

export const INTAKE_SERVICE_IDS: readonly ServiceType[] = [
  "website",
  "google_ads",
  "meta_ads",
  "seo",
];

export function isValidService(value: string): value is ServiceType {
  return (INTAKE_SERVICE_IDS as readonly string[]).includes(value);
}

/** Dedupe + drop anything outside the bounded catalog, preserving order. */
export function normalizeServiceSelection(raw: readonly string[]): ServiceType[] {
  const seen = new Set<string>();
  const out: ServiceType[] = [];
  for (const s of raw) {
    if (isValidService(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** A submittable selection is non-empty and entirely within the catalog. */
export function isSubmittableSelection(raw: readonly string[]): boolean {
  const norm = normalizeServiceSelection(raw);
  return norm.length > 0 && norm.length === raw.length;
}
