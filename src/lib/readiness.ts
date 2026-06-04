import { SERVICES } from "@/lib/services";
import type { OnboardingSubmission, ServiceType } from "@/lib/database.types";

/**
 * Defines the assets/access each service needs before delivery can begin, and
 * computes a simple Completed/Pending checklist from the client's onboarding
 * submissions. Pure (no I/O) so it can run in both server and client
 * components, and drives the client checklist + the admin readiness hint.
 */

type RequirementType = "file" | "text" | "list";

interface Requirement {
  /** Key within onboarding_submissions.data */
  key: string;
  label: string;
  type: RequirementType;
}

const REQUIREMENTS: Record<ServiceType, Requirement[]> = {
  website: [
    { key: "logo", label: "Logo", type: "file" },
    { key: "images", label: "Images", type: "file" },
  ],
  meta_ads: [
    { key: "creative_uploads", label: "Creative assets", type: "file" },
  ],
  google_ads: [
    { key: "google_ads_access", label: "Google Ads access", type: "text" },
    { key: "analytics_access", label: "Analytics access", type: "text" },
    { key: "gtm_access", label: "GTM access", type: "text" },
  ],
  seo: [
    { key: "search_console_access", label: "Search Console access", type: "text" },
    { key: "keywords", label: "Target keywords", type: "list" },
    { key: "competitors", label: "Competitors", type: "list" },
    { key: "locations", label: "Target locations", type: "list" },
  ],
};

function isProvided(value: unknown, type: RequirementType): boolean {
  if (value === null || value === undefined) return false;
  if (type === "text") return typeof value === "string" && value.trim().length > 0;
  // Both file fields and multitext lists are stored as arrays.
  return Array.isArray(value) && value.length > 0;
}

export interface ReadinessItem {
  label: string;
  done: boolean;
}

export interface ServiceReadiness {
  service: ServiceType;
  name: string;
  items: ReadinessItem[];
  done: number;
  total: number;
  complete: boolean;
}

export interface Readiness {
  services: ServiceReadiness[];
  totalDone: number;
  totalItems: number;
  /** True when every required item across all purchased services is provided. */
  allReady: boolean;
  /** False when none of the purchased services have trackable requirements. */
  hasItems: boolean;
}

export function computeReadiness(
  services: ServiceType[],
  submissions: OnboardingSubmission[]
): Readiness {
  const result: ServiceReadiness[] = [];

  for (const service of services) {
    const reqs = REQUIREMENTS[service] ?? [];
    if (reqs.length === 0) continue;

    const submission = submissions.find((s) => s.service === service);
    const data = (submission?.data ?? {}) as Record<string, unknown>;

    const items = reqs.map((r) => ({
      label: r.label,
      done: isProvided(data[r.key], r.type),
    }));
    const done = items.filter((i) => i.done).length;

    result.push({
      service,
      name: SERVICES[service].name,
      items,
      done,
      total: items.length,
      complete: done === items.length,
    });
  }

  const totalItems = result.reduce((n, s) => n + s.total, 0);
  const totalDone = result.reduce((n, s) => n + s.done, 0);

  return {
    services: result,
    totalDone,
    totalItems,
    allReady: totalItems > 0 && totalDone === totalItems,
    hasItems: totalItems > 0,
  };
}
