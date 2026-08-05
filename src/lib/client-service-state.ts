/**
 * Pure derivation of the admin "Services" manager state (no I/O).
 *
 * Joins the bounded service catalogue (SERVICE_LIST) with a client's assigned
 * `client_services` rows to produce one row per supported service. A service the
 * client does not have is "Not Added"; an assigned service maps its existing
 * `onboarding_status` to a locked UI state. No new service states are invented,
 * and "Paused" does not exist (there is no such column).
 */
import type { OnboardingStatus, ServiceType } from "@/lib/database.types";
import { SERVICE_LIST } from "@/lib/services";

export type ServiceUiState =
  | "not_added"
  | "onboarding_required"
  | "onboarding_in_progress"
  | "onboarding_submitted"
  | "onboarding_completed";

export interface ServiceStateRow {
  service: ServiceType;
  name: string;
  state: ServiceUiState;
  onboardingStatus: OnboardingStatus | null;
  addedAt: string | null;
}

/** Locked mapping: existing onboarding_status → admin UI state. */
const STATE_BY_ONBOARDING: Record<OnboardingStatus, ServiceUiState> = {
  not_started: "onboarding_required",
  in_progress: "onboarding_in_progress",
  submitted: "onboarding_submitted",
  approved: "onboarding_completed",
};

/** Locked human labels for each UI state. */
export const SERVICE_STATE_LABEL: Record<ServiceUiState, string> = {
  not_added: "Not Added",
  onboarding_required: "Active · Onboarding Required",
  onboarding_in_progress: "Active · Onboarding In Progress",
  onboarding_submitted: "Active · Onboarding Submitted",
  onboarding_completed: "Active · Onboarding Completed",
};

/** True once a service is assigned (any onboarding sub-state). */
export const isActive = (state: ServiceUiState): boolean => state !== "not_added";

interface AssignedService {
  service: ServiceType;
  onboarding_status: OnboardingStatus;
  created_at?: string | null;
}

/**
 * One row per supported service, in catalogue order. Assigned services carry
 * their real onboarding sub-state + added date; unassigned services are Not Added.
 */
export function deriveServiceStateRows(assigned: AssignedService[]): ServiceStateRow[] {
  const byService = new Map(assigned.map((a) => [a.service, a]));
  return SERVICE_LIST.map((def) => {
    const row = byService.get(def.id);
    if (!row) {
      return { service: def.id, name: def.name, state: "not_added", onboardingStatus: null, addedAt: null };
    }
    return {
      service: def.id,
      name: def.name,
      state: STATE_BY_ONBOARDING[row.onboarding_status],
      onboardingStatus: row.onboarding_status,
      addedAt: row.created_at ?? null,
    };
  });
}
