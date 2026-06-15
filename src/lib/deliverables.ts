import type { ServiceType } from "@/lib/database.types";
import { getService } from "@/lib/services";

/**
 * Premium "what you get" presentation layer over the real purchased services.
 *
 * Source of truth stays `client_services` (what the client actually bought).
 * Each service simply expands into client-friendly deliverables for display.
 * Services the client did NOT buy are surfaced separately as growth
 * opportunities — never shown as active deliverables.
 */

export interface ServiceDeliverables {
  service: ServiceType;
  /** Display name (kept in sync with the service catalog in services.ts). */
  name: string;
  deliverables: string[];
}

/** Deliverables shown for each service. Presentation only — no data model change. */
const DELIVERABLES: Record<ServiceType, string[]> = {
  website: [
    "Website Design",
    "Website Development",
    "Hosting",
    "SSL Security",
    "Mobile Optimisation",
    "Contact Forms",
  ],
  seo: [
    "SEO Setup",
    "Search Console Setup",
    "Sitemap Submission",
    "Metadata Optimisation",
  ],
  google_ads: [
    "Campaign Setup",
    "Conversion Tracking",
    "Keyword Research",
    "Monthly Optimisation",
  ],
  meta_ads: [
    "Campaign Setup",
    "Creative Testing",
    "Audience Research",
    "Monthly Optimisation",
  ],
};

const ALL_SERVICES = Object.keys(DELIVERABLES) as ServiceType[];

function build(service: ServiceType): ServiceDeliverables {
  return {
    service,
    name: getService(service).name,
    deliverables: DELIVERABLES[service],
  };
}

/**
 * Split the catalog into the client's active deliverables (purchased) and
 * growth opportunities (not purchased), preserving a stable catalog order.
 */
export function splitPackages(purchased: ServiceType[]): {
  active: ServiceDeliverables[];
  growth: ServiceDeliverables[];
} {
  const owned = new Set(purchased);
  const active: ServiceDeliverables[] = [];
  const growth: ServiceDeliverables[] = [];
  for (const service of ALL_SERVICES) {
    (owned.has(service) ? active : growth).push(build(service));
  }
  return { active, growth };
}
