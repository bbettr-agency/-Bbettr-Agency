/**
 * Pure per-service OPERATIONAL state model (Slice 2E) — no I/O, no JSX.
 *
 * Operational state ("is this service live / paused / being set up") is a
 * DIFFERENT concept from onboarding_status ("are the onboarding forms done").
 * This module is the single authority that resolves the operational state of a
 * service and never lets onboarding masquerade as operational.
 *
 * Source of truth (locked):
 *   • Website  → DERIVED ONLY from the roadmap + website URLs. Any stored
 *                operational_status on the website row is IGNORED, so the two can
 *                never contradict. Website is never manually editable.
 *   • Google Ads / Meta Ads / SEO → the STORED client_services.operational_status.
 *                NULL resolves conservatively and NEVER to active/paused; an
 *                'approved' onboarding never implies Active. Only an explicit
 *                admin value may claim active / paused / in_progress.
 */
import type { OnboardingStatus, ServiceType } from "@/lib/database.types";

export type OperationalStatus =
  | "not_started"
  | "setup"
  | "in_progress"
  | "active"
  | "paused";

export const OPERATIONAL_STATUSES: readonly OperationalStatus[] = [
  "not_started",
  "setup",
  "in_progress",
  "active",
  "paused",
];

/** True for a valid canonical operational value (mirrors the 0057 CHECK). */
export function isOperationalStatus(v: string): v is OperationalStatus {
  return (OPERATIONAL_STATUSES as readonly string[]).includes(v);
}

/** Only these services carry an editable, stored operational status. */
export function isOperationalEditable(service: ServiceType): boolean {
  return service !== "website";
}

/** Options an admin may set for ads/SEO (website is never editable). */
export const ADS_SEO_EDITABLE_OPTIONS: readonly OperationalStatus[] = [
  "not_started",
  "setup",
  "in_progress",
  "active",
  "paused",
];

const nonEmpty = (u: string | null | undefined): boolean =>
  typeof u === "string" && u.trim().length > 0;

// ── Website: derived only ───────────────────────────────────────────────────

export interface WebsiteSignals {
  liveUrl: string | null;
  previewUrl: string | null;
  /** The "Launch" stage is completed. */
  launchCompleted: boolean;
  /** Any roadmap stage is in_progress or completed (meaningful progress). */
  hasRoadmapProgress: boolean;
}

/**
 * Website operational state, DERIVED. A live URL or a completed Launch is the
 * strongest signal (Live); a preview URL or meaningful roadmap progress means In
 * Development; otherwise Not Started. Single function ⇒ no contradiction.
 */
export function deriveWebsiteOperational(sig: WebsiteSignals): OperationalStatus {
  if (nonEmpty(sig.liveUrl) || sig.launchCompleted) return "active"; // display "Live"
  if (nonEmpty(sig.previewUrl) || sig.hasRoadmapProgress) return "in_progress";
  return "not_started";
}

// ── Ads / SEO: stored, NULL resolved conservatively ─────────────────────────

/**
 * Resolve ads/SEO operational state. An explicit stored value always wins.
 * NULL never becomes active/paused:
 *   • onboarding not begun / untouched → not_started
 *   • onboarding underway or completed  → setup ("we're setting things up")
 * 'approved' onboarding therefore resolves to Setup, NOT Active.
 */
export function resolveAdsSeoOperational(input: {
  operationalStatus: OperationalStatus | null;
  onboardingStatus: OnboardingStatus | null;
}): OperationalStatus {
  if (input.operationalStatus) return input.operationalStatus;
  if (!input.onboardingStatus || input.onboardingStatus === "not_started") {
    return "not_started";
  }
  return "setup";
}

// ── Unified resolver ────────────────────────────────────────────────────────

export interface ServiceOperationalInput {
  service: ServiceType;
  /** Stored client_services.operational_status (ignored for website). */
  operationalStatus: OperationalStatus | null;
  onboardingStatus: OnboardingStatus | null;
  /** Required when service === "website". */
  website?: WebsiteSignals;
}

const NO_WEBSITE_SIGNALS: WebsiteSignals = {
  liveUrl: null,
  previewUrl: null,
  launchCompleted: false,
  hasRoadmapProgress: false,
};

/** The authoritative operational state for a service. */
export function resolveServiceOperational(input: ServiceOperationalInput): OperationalStatus {
  if (input.service === "website") {
    // operationalStatus is deliberately IGNORED for website.
    return deriveWebsiteOperational(input.website ?? NO_WEBSITE_SIGNALS);
  }
  return resolveAdsSeoOperational({
    operationalStatus: input.operationalStatus,
    onboardingStatus: input.onboardingStatus,
  });
}

// ── Labels ──────────────────────────────────────────────────────────────────

const ADMIN_LABEL: Record<OperationalStatus, string> = {
  not_started: "Not Started",
  setup: "Setup",
  in_progress: "In Progress",
  active: "Active",
  paused: "Paused",
};

/** Admin-facing label (short). Website 'active' shows as "Live". */
export function adminOperationalLabel(service: ServiceType, status: OperationalStatus): string {
  if (service === "website" && status === "active") return "Live";
  return ADMIN_LABEL[status];
}

/** Client-facing label (friendly), adapted per service. */
export function clientOperationalLabel(service: ServiceType, status: OperationalStatus): string {
  switch (status) {
    case "not_started":
      return "Not started yet";
    case "setup":
      return "We’re setting things up";
    case "in_progress":
      return service === "website" ? "In development" : "Getting things running";
    case "active":
      return service === "website" ? "Live" : "Active";
    case "paused":
      return "Paused";
  }
}
