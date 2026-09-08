/**
 * Pure intake → onboarding carry-over mapping (P1) — no I/O, no JSX.
 *
 * The public intake reuses the SAME stable field-name keys as the formal
 * onboarding schema (services.ts). This module maps a prospect's collected
 * answers onto the valid onboarding field names for a service, so on conversion
 * (P4) the client never re-enters what they already told us.
 *
 * IMPORTANT (locked decision): carrying answers forward does NOT mean formal
 * client onboarding has started. A pre-sales intake and formal onboarding are
 * conceptually separate stages. So `CARRIED_OVER_ONBOARDING_STATUS` is
 * `not_started` — conversion seeds the answers as data only; it must never set a
 * misleading "in_progress"/"submitted" onboarding state merely because an intake
 * was completed. The P4 conversion is the sole owner of onboarding status and
 * will use this constant.
 */
import type { OnboardingField, ServiceDefinition } from "@/lib/services";
import { SERVICES } from "@/lib/services";
import type { OnboardingStatus, ServiceType } from "@/lib/database.types";

/** Onboarding status a carried-over intake produces: pre-sales ≠ onboarding started. */
export const CARRIED_OVER_ONBOARDING_STATUS: OnboardingStatus = "not_started";

/** Every field name defined for a service (including nested group-list subFields). */
export function onboardingFieldNames(service: ServiceType): Set<string> {
  const def: ServiceDefinition | undefined = SERVICES[service];
  const names = new Set<string>();
  if (!def) return names;
  const walk = (fields: OnboardingField[]) => {
    for (const f of fields) {
      if (f.name) names.add(f.name);
      if (f.subFields) walk(f.subFields);
    }
  };
  for (const section of def.sections) walk(section.fields);
  return names;
}

/**
 * Pick only the keys from a prospect's intake `data` that are real onboarding
 * field names for `service`. Extra intake-only keys (and the reserved __* keys)
 * are dropped, so the result is shape-compatible with onboarding_submissions.data.
 * Never throws; unknown service → {}.
 */
export function pickCarryOverData(
  intakeData: Record<string, unknown>,
  service: ServiceType
): Record<string, unknown> {
  const allowed = onboardingFieldNames(service);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intakeData)) {
    // Reserved metadata (e.g. _prefill) is never a real onboarding field and
    // must never carry into formal onboarding — exclude any "_"-prefixed key.
    if (key.startsWith("_")) continue;
    if (allowed.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}
