/**
 * Admin-facing presenter for a stored prospect intake (P3-A) — pure, no JSX.
 *
 * Turns the canonical `prospect_intakes` row (promoted columns + `data` JSONB)
 * into a labelled view model the Admin Intakes detail renders: a prominent
 * contact header + logically grouped questionnaire answers. Labels derive from
 * the SAME schema the public form used (intake-schema.ts), so nothing drifts and
 * no raw JSON is ever shown. Reserved (`_`-prefixed) keys and unknown fields are
 * never surfaced.
 */
import type { ServiceType } from "@/lib/database.types";
import {
  BUSINESS_FIELDS,
  GOALS_FIELDS,
  BUDGET_FIELDS,
  SERVICE_FIELDS,
  SELECTED_SERVICES_KEY,
  SERVICES_UNCERTAIN_KEY,
  type PublicField,
} from "./intake-schema";
import { INTAKE_SERVICE_IDS, normalizeServiceSelection } from "./intake-lifecycle";

/** Human names for the bounded service catalog (single source of truth). */
export const SERVICE_LABELS: Record<ServiceType, string> = {
  website: "Website Design",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  seo: "SEO",
};

/** Field name → label, derived from the schema (never a hand-copied map). */
const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  [
    ...BUSINESS_FIELDS,
    ...GOALS_FIELDS,
    ...BUDGET_FIELDS,
    ...(Object.values(SERVICE_FIELDS).flat() as PublicField[]),
  ].map((f) => [f.name, f.label])
);

export interface DetailRow {
  label: string;
  value: string;
}
export interface DetailSection {
  title: string;
  rows: DetailRow[];
}
export interface IntakeHeader {
  business: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  website: string | null;
  services: string[]; // human labels, or [] when "not sure yet"
  uncertain: boolean;
  submittedAt: string | null;
  status: string;
  source: string;
}
export interface PresentedIntake {
  header: IntakeHeader;
  sections: DetailSection[];
}

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).join(", ");
  return typeof v === "string" ? v : String(v);
}
function nn(v: unknown): string | null {
  const s = str(v).trim();
  return s.length > 0 ? s : null;
}

/** Rows for a set of field names, in schema order, skipping empty answers. */
function rowsFor(data: Record<string, unknown>, fields: readonly PublicField[]): DetailRow[] {
  const out: DetailRow[] = [];
  for (const f of fields) {
    const value = str(data[f.name]).trim();
    if (value) out.push({ label: FIELD_LABEL[f.name] ?? f.name, value });
  }
  return out;
}

export interface IntakeRowLike {
  status: string;
  source: string;
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  selected_services: string[] | null;
  submitted_at: string | null;
  data: Record<string, unknown> | null;
}

export function presentIntake(row: IntakeRowLike): PresentedIntake {
  const data = (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>;

  // Services: prefer the canonical `data`, fall back to the promoted column.
  const selectedRaw = Array.isArray(data[SELECTED_SERVICES_KEY])
    ? (data[SELECTED_SERVICES_KEY] as string[])
    : row.selected_services ?? [];
  const selected = normalizeServiceSelection(selectedRaw);
  const uncertain = data[SERVICES_UNCERTAIN_KEY] === true;

  const header: IntakeHeader = {
    business: row.business_name ?? nn(data.business_name),
    contact: row.contact_name ?? nn(data.contact_name),
    email: row.email ?? nn(data.email),
    phone: row.phone ?? nn(data.phone),
    location: nn(data.location),
    website: nn(data.existing_website_url),
    services: selected.map((s) => SERVICE_LABELS[s]),
    uncertain,
    submittedAt: row.submitted_at,
    status: row.status,
    source: row.source,
  };

  const sections: DetailSection[] = [];

  // What they want help with.
  sections.push({
    title: "What they want help with",
    rows: uncertain
      ? [{ label: "Services", value: "Not sure yet — wants guidance" }]
      : [{ label: "Services", value: selected.map((s) => SERVICE_LABELS[s]).join(", ") || "—" }],
  });

  // Per-service detail (only for selected services that have answers/fields).
  for (const service of selected) {
    const rows = rowsFor(data, SERVICE_FIELDS[service]);
    if (rows.length > 0) sections.push({ title: `${SERVICE_LABELS[service]} details`, rows });
  }

  // Goals + Budget & timing.
  const goals = rowsFor(data, GOALS_FIELDS);
  if (goals.length > 0) sections.push({ title: "Goals", rows: goals });
  const budget = rowsFor(data, BUDGET_FIELDS);
  if (budget.length > 0) sections.push({ title: "Budget & timing", rows: budget });

  return { header, sections };
}

/** Convenience for lists: which service labels a row selected (catalog order). */
export function serviceLabelsFor(selected: string[] | null | undefined): string[] {
  return normalizeServiceSelection(Array.isArray(selected) ? selected : []).map(
    (s) => SERVICE_LABELS[s]
  );
}

export { INTAKE_SERVICE_IDS };
