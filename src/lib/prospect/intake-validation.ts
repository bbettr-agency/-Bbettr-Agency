/**
 * Per-section validation for the public intake (P2-B) — pure, forgiving,
 * server-safe. Only truly necessary information is required; steps 3–5 are
 * optional. These helpers run at the public write boundary later, so all input
 * is treated as untrusted.
 */
import {
  LIMITS,
  GOAL_OPTIONS,
  INVESTMENT_OPTIONS,
  READINESS_OPTIONS,
  WEBSITE_GOAL_OPTIONS,
  RUNNING_OPTIONS,
} from "./intake-schema";
import { normalizeServiceSelection } from "./intake-lifecycle";

export type FieldErrors = Record<string, string>;
export interface ValidationResult {
  ok: boolean;
  errors: FieldErrors;
}

const ok = (): ValidationResult => ({ ok: true, errors: {} });
function fail(errors: FieldErrors): ValidationResult {
  return { ok: Object.keys(errors).length === 0, errors };
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Lenient email check — presence + a single @ with a dotted domain. */
export function isValidEmail(v: unknown): boolean {
  const t = s(v);
  return t.length > 0 && t.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

// ── Step 1 — Your business ──────────────────────────────────────────────────
export function validateBusiness(input: unknown): ValidationResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (!s(src.contact_name)) errors.contact_name = "Please tell us your name.";
  else if (s(src.contact_name).length > LIMITS.name) errors.contact_name = "That name is too long.";
  if (!s(src.business_name)) errors.business_name = "Please add your business name.";
  else if (s(src.business_name).length > LIMITS.business) errors.business_name = "That business name is too long.";
  if (!s(src.email)) errors.email = "We'll need your email to follow up.";
  else if (!isValidEmail(src.email)) errors.email = "That doesn't look like a valid email.";
  // phone / website / location are optional and lenient (normalizer handles them).
  return fail(errors);
}

// ── Step 2 — Services ────────────────────────────────────────────────────────
export function validateServices(input: {
  selected_services?: unknown;
  services_uncertain?: unknown;
}): ValidationResult {
  const selected = normalizeServiceSelection(
    Array.isArray(input.selected_services) ? (input.selected_services as string[]) : []
  );
  const uncertain = input.services_uncertain === true;
  if (uncertain || selected.length > 0) return ok();
  return fail({
    selected_services: "Choose what you'd like help with — or tell us you're not sure yet.",
  });
}

// ── Steps 3–5 — optional; only reject present-but-invalid enum/list values ──
function badEnum(v: unknown, options: readonly string[]): boolean {
  const t = s(v);
  return t.length > 0 && !options.includes(t);
}

export function validateDetails(input: unknown): ValidationResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (badEnum(src.website_goal_primary, WEBSITE_GOAL_OPTIONS)) errors.website_goal_primary = "Please choose one of the options.";
  if (badEnum(src.google_ads_running, RUNNING_OPTIONS)) errors.google_ads_running = "Please choose one of the options.";
  if (badEnum(src.meta_ads_running, RUNNING_OPTIONS)) errors.meta_ads_running = "Please choose one of the options.";
  return fail(errors);
}

export function validateGoals(input: unknown): ValidationResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (Array.isArray(src.goals)) {
    const bad = (src.goals as unknown[]).some(
      (g) => typeof g === "string" && g.trim() && !(GOAL_OPTIONS as readonly string[]).includes(g.trim())
    );
    if (bad) errors.goals = "One of the selected goals isn't recognised.";
  }
  if (s(src.goals_note).length > LIMITS.note) errors.goals_note = "That's a little too long.";
  return fail(errors);
}

export function validateBudget(input: unknown): ValidationResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (badEnum(src.investment_band, INVESTMENT_OPTIONS)) errors.investment_band = "Please choose one of the options.";
  if (badEnum(src.readiness, READINESS_OPTIONS)) errors.readiness = "Please choose one of the options.";
  return fail(errors);
}

/** Whole-submission gate: the only hard requirements are steps 1 + 2. */
export function validateForSubmit(input: unknown): ValidationResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const parts = [
    validateBusiness(src),
    validateServices(src as { selected_services?: unknown; services_uncertain?: unknown }),
    validateDetails(src),
    validateGoals(src),
    validateBudget(src),
  ];
  const errors: FieldErrors = {};
  for (const p of parts) Object.assign(errors, p.errors);
  return fail(errors);
}
