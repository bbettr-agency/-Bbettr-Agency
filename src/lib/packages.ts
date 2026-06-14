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
    key: "new_website",
    label: "New Website",
    description: "Design and build of a new website.",
    billing: "once_off",
  },
  {
    key: "website_redesign_dev",
    label: "Website Redesign + Development",
    description: "Redesign and development of an existing website.",
    billing: "once_off",
  },
  {
    key: "website_redesign_dev_seo",
    label: "Website Redesign + Development + SEO",
    description:
      "Website redesign, development and search engine optimisation (SEO).",
    billing: "once_off",
  },
  {
    key: "onceoff_website",
    label: "Once-off Website Package",
    description: "Once-off website package.",
    billing: "once_off",
  },
  {
    key: "onceoff_premium_website",
    label: "Once-off Premium Website Package",
    description: "Once-off premium website package.",
    billing: "once_off",
  },
  {
    key: "monthly_website_retainer",
    label: "Monthly Website Retainer",
    description: "Monthly website maintenance and support retainer.",
    billing: "monthly",
  },
  {
    key: "google_ads",
    label: "Google Ads Management",
    description: "Monthly Google Ads campaign management and optimisation.",
    billing: "monthly",
  },
  {
    key: "meta_ads",
    label: "Meta Ads Management",
    description:
      "Monthly Meta (Facebook & Instagram) Ads campaign management and optimisation.",
    billing: "monthly",
  },
  {
    key: "crm_automation",
    label: "CRM / Automation Setup",
    description: "CRM and marketing automation setup.",
    billing: "once_off",
  },
  {
    key: CUSTOM_PACKAGE_KEY,
    label: "Custom Package",
    description: "",
    billing: "once_off",
  },
];

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
