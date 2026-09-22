import type { ProjectStage } from "@/lib/database.types";

/**
 * Client-facing project journey — a PRESENTATION layer over the internal
 * operational `project_stages`. The internal stages (and all automations,
 * approvals and project management that key off them) are unchanged; the client
 * only ever sees the premium journey labels below.
 *
 * Mapping (internal operational name → client-facing label):
 *   Contract Signed      → Discovery
 *   Onboarding Submitted → Strategy
 *   Assets Received      → Design
 *   In Development       → Development
 *   Review Stage         → Testing
 *   Launch               → Launch
 *
 * Any stage whose internal name is not in the map resolves to a SAFE, generic
 * client-facing label — internal/operational names must never leak to the client.
 */
export const STAGE_TO_JOURNEY: Record<string, string> = {
  "Contract Signed": "Discovery",
  "Onboarding Submitted": "Strategy",
  "Assets Received": "Design",
  "In Development": "Development",
  "Review Stage": "Testing",
  Launch: "Launch",
};

/** Neutral client-facing label used when an internal stage name isn't mapped. */
export const SAFE_STAGE_LABEL = "Project phase";

/**
 * THE client-facing label for an internal stage name. Every client-visible stage
 * label must resolve through here so raw internal text can never reach a client
 * (admin surfaces may still show the internal name where operationally useful).
 */
export function clientStageLabel(internalName: string): string {
  return STAGE_TO_JOURNEY[internalName] ?? SAFE_STAGE_LABEL;
}

/** Canonical client-facing journey order (for reference / seeding). */
export const JOURNEY_STEPS = [
  "Discovery",
  "Strategy",
  "Design",
  "Development",
  "Testing",
  "Launch",
] as const;

export type JourneyStatus = "completed" | "in_progress" | "pending";

export interface JourneyStage {
  /** Client-facing label shown in the portal. */
  label: string;
  /** Underlying internal stage name (never shown to the client). */
  internalName: string;
  status: JourneyStatus;
  position: number;
  targetDate: string | null;
}

/** Map a client's internal stages to the client-facing journey (presentation only). */
export function toClientJourney(stages: ProjectStage[]): JourneyStage[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      label: clientStageLabel(s.name),
      internalName: s.name,
      status: s.status as JourneyStatus,
      position: s.position,
      targetDate: s.target_date ?? null,
    }));
}

/**
 * The current journey step label: the in-progress stage if any, else the first
 * pending stage, else the final stage (everything complete). Mirrors the
 * existing `currentPhase` logic but in client-facing labels.
 */
export function currentJourneyLabel(journey: JourneyStage[]): string | null {
  if (journey.length === 0) return null;
  const active = journey.find((j) => j.status === "in_progress");
  if (active) return active.label;
  const pending = journey.find((j) => j.status === "pending");
  if (pending) return pending.label;
  return journey[journey.length - 1].label;
}
