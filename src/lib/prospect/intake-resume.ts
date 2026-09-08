/**
 * Deterministic resume-section logic for a returning draft (P2-D) — pure, no I/O.
 *
 * When a prospect reopens /start/<token>, we must land them at a sensible point
 * WITHOUT forcing a restart and WITHOUT trapping them on blank optional answers
 * (steps 3–5 are all optional). No schema tracks "current step", so the furthest
 * section actually reached is RECONSTRUCTED from the normalized data that exists:
 *
 *   • Steps 1 (business) and 2 (services) are the only required gates. If either
 *     is incomplete we resume there.
 *   • Beyond that, we infer progress from which later answers are present, always
 *     resuming at a section the prospect can move FORWARD through (every target
 *     below accepts blank optional input), so a returning draft is never trapped.
 *
 * All target sections are reachable forward via Continue with blanks, and the
 * Review section exposes Edit for every group, so nothing is ever unreachable.
 */
import type { IntakeSectionId } from "./intake-steps";
import { validateBusiness } from "./intake-validation";
import { normalizeServiceSelection } from "./intake-lifecycle";
import { ALL_SERVICE_FIELDS, SERVICES_UNCERTAIN_KEY } from "./intake-schema";

function rec(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** Steps 1 gate: required business fields present + valid (mirrors the server). */
export function isBusinessComplete(data: unknown): boolean {
  return validateBusiness(rec(data)).ok;
}

/** Step 2 gate: at least one real service OR an explicit "not sure yet". */
export function isServicesDecided(data: unknown): boolean {
  const d = rec(data);
  const selected = normalizeServiceSelection(
    Array.isArray(d.selected_services) ? (d.selected_services as string[]) : []
  );
  return selected.length > 0 || d[SERVICES_UNCERTAIN_KEY] === true;
}

const SERVICE_DETAIL_KEYS = ALL_SERVICE_FIELDS.map((f) => f.name);

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function hasAnyServiceDetail(data: unknown): boolean {
  const d = rec(data);
  return SERVICE_DETAIL_KEYS.some((k) => present(d[k]));
}
export function hasAnyGoalsAnswer(data: unknown): boolean {
  const d = rec(data);
  return present(d.goals) || present(d.goals_note);
}
export function hasAnyBudgetAnswer(data: unknown): boolean {
  const d = rec(data);
  return present(d.investment_band) || present(d.readiness);
}

/**
 * The section a returning draft should resume at. Deterministic and total:
 * every code path returns exactly one section, and every returned section is
 * forward-navigable with optional blanks (never a trap).
 */
export function resumeSection(data: unknown): IntakeSectionId {
  const d = rec(data);
  if (!isBusinessComplete(d)) return "business";
  if (!isServicesDecided(d)) return "services";

  // Steps 1 + 2 done — infer the furthest section reached from later answers.
  if (hasAnyBudgetAnswer(d)) return "review"; // reached the final input section
  if (hasAnyGoalsAnswer(d)) return "budget"; // was at/around budget & timing

  const uncertain = d[SERVICES_UNCERTAIN_KEY] === true;
  if (uncertain) return "goals"; // "details" is skipped when unsure
  if (hasAnyServiceDetail(d)) return "goals"; // details answered, move on

  return "details"; // real services chosen, details not started yet — offer them
}
