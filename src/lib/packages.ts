import type { BillingType } from "@/lib/database.types";

/**
 * Canonical catalogue of BBettr service packages. This is the single source of
 * truth for the New Deal dropdown, server-side validation, and the QuickBooks
 * invoice line (product/service name + description).
 *
 * Kept in code (not a DB enum) deliberately: packages and naming evolve often,
 * and we don't want a migration every time one is added or renamed. Deals store
 * a `package_key` (validated against this list) plus, for the custom package, a
 * free `custom_package_name` / `custom_package_description`.
 */

export const CUSTOM_PACKAGE_KEY = "custom";

export interface ServicePackage {
  /** Stable key stored on the deal (`deals.package_key`). */
  key: string;
  /** Human label — shown in the UI and used as the QBO product/service name. */
  label: string;
  /** Default invoice line description (overridable for the custom package). */
  description: string;
  /** Suggested billing type (the rep can still change it on the form). */
  billing: BillingType;
}

export const SERVICE_PACKAGES: ServicePackage[] = [
  {
    key: "onceoff_premium_website",
    label: "Once-off Premium Website Package",
    description:
      "Custom website redesign and development focused on improving user experience, lead generation, mobile responsiveness, search engine visibility, and overall business credibility. Includes design, development, optimization, testing, and deployment.",
    billing: "once_off",
  },
  {
    key: "google_ads",
    label: "Google Ads Management",
    description:
      "Professional Google Ads campaign management focused on increasing qualified leads, enquiries, and sales. Includes campaign setup, keyword research, audience targeting, ad creation, conversion tracking, performance monitoring, ongoing optimization, and monthly reporting to maximize return on ad spend.",
    billing: "monthly",
  },
  {
    key: "meta_ads",
    label: "Meta Ads Management",
    description:
      "Professional Facebook and Instagram advertising management focused on generating qualified leads, enquiries, and sales. Includes campaign setup, audience targeting, creative strategy, ad management, conversion tracking, performance optimization, and ongoing campaign improvements to maximize results and return on investment.",
    billing: "monthly",
  },
  {
    key: "crm_automation",
    label: "CRM & Automation Setup",
    description:
      "Custom CRM and business automation setup designed to streamline lead management, follow-ups, appointment scheduling, customer communication, and sales processes. Includes workflow creation, automation configuration, pipeline setup, notifications, and system optimization to improve efficiency and conversion rates.",
    billing: "once_off",
  },
];

/**
 * The single approved monthly retainer add-on. Selected via the "Add Monthly
 * Retainer?" toggle on the New Deal form; its name + description are applied
 * server-side (the rep enters only the amount) and it becomes a separate
 * invoice line. Not commissioned.
 */
export const WEBSITE_SEO_RETAINER = {
  key: "website_seo_retainer",
  name: "Website Maintenance & SEO Retainer",
  description:
    "Monthly website maintenance and SEO growth service including website updates, technical optimization, performance monitoring, content improvements, search engine optimization, and ongoing enhancements designed to increase visibility, rankings, and lead generation over time.",
} as const;

const BY_KEY = new Map(SERVICE_PACKAGES.map((p) => [p.key, p]));

export function getPackage(key: string | null | undefined): ServicePackage | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** True if `key` is a real catalogue key. */
export function isValidPackageKey(key: string | null | undefined): boolean {
  return Boolean(key && BY_KEY.has(key));
}

export function isCustomPackage(key: string | null | undefined): boolean {
  return key === CUSTOM_PACKAGE_KEY;
}

export interface ResolvedPackage {
  /** Display label, stored on `deals.package` for existing UI/emails. */
  label: string;
  /** QBO product/service item name (find-or-create by this exact name). */
  qboItemName: string;
  /** QBO invoice line description. */
  description: string;
}

/**
 * Resolve the display label, QBO item name and invoice description for a deal.
 * Handles three cases:
 *  - a catalogue package (uses its label + description),
 *  - the custom package (uses the supplied name + description),
 *  - a legacy/free-text deal with no `package_key` (falls back to the old
 *    free-text `package`), so retries on historic deals still invoice cleanly.
 */
export function resolvePackage(opts: {
  packageKey: string | null | undefined;
  customName?: string | null;
  customDescription?: string | null;
  legacyPackage?: string | null;
}): ResolvedPackage {
  const { packageKey, customName, customDescription, legacyPackage } = opts;

  if (isCustomPackage(packageKey)) {
    const name = (customName ?? "").trim() || "Custom Package";
    return {
      label: name,
      qboItemName: name,
      description: (customDescription ?? "").trim() || name,
    };
  }

  const pkg = getPackage(packageKey);
  if (pkg) {
    return { label: pkg.label, qboItemName: pkg.label, description: pkg.description };
  }

  // Legacy deal created before structured packages — use its free text.
  const legacy = (legacyPackage ?? "").trim();
  if (legacy) {
    return { label: legacy, qboItemName: legacy, description: legacy };
  }
  return { label: "Service", qboItemName: "Agency Services", description: "" };
}
