/**
 * Public prospect-intake question schema (P2-B) — pure data + types, no I/O.
 *
 * This is a LIGHT, sales-stage schema, deliberately independent of the
 * authenticated delivery onboarding schema (src/lib/services.ts). It reuses
 * stable field-name keys ONLY where genuinely compatible with later onboarding
 * carry-over (annotated `carryOver: true`); everything else is intake-only.
 *
 * Sections mirror the fixed six-section journey (see intake-steps.ts). "Review"
 * adds no fields — it just re-presents the earlier sections.
 */
import type { ServiceType } from "@/lib/database.types";
import type { IntakeSectionId } from "./intake-steps";

export type PublicFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "choice-cards" // single-select cards
  | "chips" // multi-select chips
  | "multitext"; // list of short free-text entries

export interface PublicField {
  name: string;
  label: string;
  type: PublicFieldType;
  required?: boolean;
  help?: string;
  /** Options for choice-cards / chips (canonical stored values). */
  options?: readonly string[];
  /** Max characters for text-like fields (server-enforced). */
  maxLength?: number;
  /** True when this key maps to a real onboarding field and can carry forward. */
  carryOver?: boolean;
}

// ── Option sets (canonical stored values) ───────────────────────────────────
export const WEBSITE_GOAL_OPTIONS = [
  "Get leads",
  "Sell online",
  "Look credible",
  "Replace an old site",
] as const;
export const RUNNING_OPTIONS = ["Yes", "No", "Not sure"] as const;
export const GOAL_OPTIONS = [
  "More leads",
  "More bookings/calls",
  "Online sales",
  "A better website",
  "Grow local visibility",
  "Brand awareness",
  "Improve current marketing",
] as const;
export const INVESTMENT_OPTIONS = [
  "Not sure yet",
  "Under R5,000",
  "R5,000 – R15,000",
  "R15,000 – R50,000",
  "R50,000+",
] as const;
export const READINESS_OPTIONS = [
  "Ready to get started",
  "Within the next month",
  "In the next few months",
  "Just exploring",
] as const;

// ── Field limits (server-enforced caps) ─────────────────────────────────────
export const LIMITS = {
  name: 120,
  business: 160,
  email: 254,
  phone: 40,
  location: 160,
  url: 2048,
  handles: 200,
  note: 2000,
  keywordItem: 80,
  keywords: 25,
  goals: GOAL_OPTIONS.length,
} as const;

// ── Step 1 — Your business ──────────────────────────────────────────────────
export const BUSINESS_FIELDS: readonly PublicField[] = [
  { name: "contact_name", label: "Your name", type: "text", required: true, maxLength: LIMITS.name },
  { name: "business_name", label: "Business name", type: "text", required: true, maxLength: LIMITS.business },
  { name: "email", label: "Email", type: "email", required: true, maxLength: LIMITS.email },
  { name: "phone", label: "Phone (WhatsApp)", type: "tel", maxLength: LIMITS.phone },
  // existing_website_url is a real onboarding key → carries forward.
  { name: "existing_website_url", label: "Website", type: "url", maxLength: LIMITS.url, carryOver: true },
  { name: "location", label: "Location / areas served", type: "text", maxLength: LIMITS.location },
];

// ── Step 3 — Service details (only for selected services; no repeats) ───────
export const SERVICE_FIELDS: Record<ServiceType, readonly PublicField[]> = {
  website: [
    {
      name: "website_goal_primary",
      label: "What's the main job of the new site?",
      type: "choice-cards",
      options: WEBSITE_GOAL_OPTIONS,
    },
    // NOTE: website URL is NOT re-asked — it comes from step 1 (existing_website_url).
  ],
  google_ads: [
    { name: "google_ads_running", label: "Running Google Ads today?", type: "choice-cards", options: RUNNING_OPTIONS },
  ],
  meta_ads: [
    { name: "meta_ads_running", label: "Running Facebook/Instagram ads today?", type: "choice-cards", options: RUNNING_OPTIONS },
    { name: "meta_social_handles", label: "Facebook/Instagram handle?", type: "text", maxLength: LIMITS.handles },
  ],
  seo: [
    // keywords is a real onboarding key → carries forward. Location is NOT re-asked.
    { name: "keywords", label: "What do you want to be found for?", type: "multitext", carryOver: true },
  ],
};

// ── Step 4 — Goals ───────────────────────────────────────────────────────────
export const GOALS_FIELDS: readonly PublicField[] = [
  { name: "goals", label: "What are you hoping to achieve?", type: "chips", options: GOAL_OPTIONS },
  { name: "goals_note", label: "Anything else?", type: "textarea", maxLength: LIMITS.note },
];

// ── Step 5 — Budget & timing ─────────────────────────────────────────────────
export const BUDGET_FIELDS: readonly PublicField[] = [
  {
    name: "investment_band",
    label: "What kind of monthly investment are you considering?",
    help: "This just helps us recommend a realistic starting point.",
    type: "choice-cards",
    options: INVESTMENT_OPTIONS,
  },
  { name: "readiness", label: "When are you hoping to start?", type: "choice-cards", options: READINESS_OPTIONS },
];

/** All top-level (non service-scoped) fields, for normalization + review. */
export const COMMON_FIELDS: readonly PublicField[] = [
  ...BUSINESS_FIELDS,
  ...GOALS_FIELDS,
  ...BUDGET_FIELDS,
];

/** Every service-detail field, flattened. */
export const ALL_SERVICE_FIELDS: readonly PublicField[] = (
  Object.values(SERVICE_FIELDS) as PublicField[][]
).flat();

/** Every known data field name the schema defines (excludes reserved/meta keys). */
export const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set(
  [...COMMON_FIELDS, ...ALL_SERVICE_FIELDS].map((f) => f.name)
);

/** Non-field data keys the schema stores. */
export const SERVICES_UNCERTAIN_KEY = "services_uncertain";
export const SELECTED_SERVICES_KEY = "selected_services";
/** Reserved metadata prefix — never a form field, never carried to onboarding. */
export const RESERVED_PREFIX = "_";
export const PREFILL_KEY = "_prefill";

export function isReservedIntakeKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX);
}

/** Review grouping metadata — lets the later UI build a concise review. */
export interface ReviewGroup {
  section: IntakeSectionId;
  label: string;
  fieldNames: string[];
}
export const REVIEW_GROUPS: readonly ReviewGroup[] = [
  { section: "business", label: "Your business", fieldNames: BUSINESS_FIELDS.map((f) => f.name) },
  { section: "services", label: "What we can help with", fieldNames: [SELECTED_SERVICES_KEY, SERVICES_UNCERTAIN_KEY] },
  { section: "details", label: "A few details", fieldNames: ALL_SERVICE_FIELDS.map((f) => f.name) },
  { section: "goals", label: "Your goals", fieldNames: GOALS_FIELDS.map((f) => f.name) },
  { section: "budget", label: "Budget & timing", fieldNames: BUDGET_FIELDS.map((f) => f.name) },
];
