/**
 * Single canonical normalizer for public intake data (P2-B) — pure, no I/O.
 *
 * CANONICAL MODEL: the `data` JSONB object is the ONE source of truth. Promoted
 * columns (business_name/contact_name/email/phone/selected_services) are always
 * DERIVED from normalized `data` via derivePromotedColumns — never trusted from
 * client input — so they cannot drift. The later save/submit server actions call
 * `normalizeIntakeData` then `derivePromotedColumns`; nothing else writes columns.
 *
 * Security: input is untrusted. We never spread untrusted objects into output,
 * we ignore prototype-polluting keys, and we emit ONLY known schema keys plus
 * the reserved `_prefill` metadata + `services_uncertain` — unknown keys are
 * dropped deliberately.
 */
import type { ServiceType } from "@/lib/database.types";
import { normalizeServiceSelection } from "./intake-lifecycle";
import { isStorableUrl } from "@/lib/website-state";
import {
  LIMITS,
  GOAL_OPTIONS,
  INVESTMENT_OPTIONS,
  READINESS_OPTIONS,
  WEBSITE_GOAL_OPTIONS,
  RUNNING_OPTIONS,
  PREFILL_KEY,
  SERVICES_UNCERTAIN_KEY,
  SELECTED_SERVICES_KEY,
  KNOWN_FIELD_NAMES,
  isReservedIntakeKey,
} from "./intake-schema";

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Read a plain object safely from untrusted input (never the input itself). */
function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input as object)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = (input as Record<string, unknown>)[key];
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function trimCap(v: unknown, max: number): string {
  return str(v).trim().slice(0, max);
}
/** Trimmed value, or null when empty. */
function textOrNull(v: unknown, max: number): string | null {
  const t = trimCap(v, max);
  return t.length > 0 ? t : null;
}
function normalizeEmail(v: unknown): string | null {
  const t = trimCap(v, LIMITS.email).toLowerCase();
  return t.length > 0 ? t : null;
}
function pickEnum<T extends string>(v: unknown, options: readonly T[]): T | null {
  const t = str(v).trim();
  return (options as readonly string[]).includes(t) ? (t as T) : null;
}

/**
 * Normalize a bare/optional website URL. Accepts example.com / www.example.com /
 * https://example.com; prepends https:// to a scheme-less domain (requires a dot);
 * rejects dangerous/non-http(s) schemes (javascript:, data:, file:, …) via the
 * shared isStorableUrl safety check. Returns a safe URL string or null.
 */
export function normalizeWebsiteUrl(raw: unknown): string | null {
  const t = str(raw).trim();
  if (!t) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t);
  if (!hasScheme && !t.includes(".")) return null; // a bare word is not a domain
  const candidate = hasScheme ? t : `https://${t}`;
  if (candidate.length > LIMITS.url) return null;
  return isStorableUrl(candidate) ? candidate : null;
}

/** Dedupe + trim + cap a multitext list; drop empties. */
function normalizeList(v: unknown, itemMax: number, listMax: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const t = str(item).trim().slice(0, itemMax);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length >= listMax) break;
    }
  }
  return out;
}

/** Sanitize the reserved `_prefill` metadata object (preserved, never authoritative). */
function normalizePrefill(v: unknown): Record<string, unknown> | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const src = asRecord(v);
  const out: Record<string, unknown> = {};
  // Preserve only primitive/array values under known prefill sub-keys shape;
  // stored verbatim for later admin comparison, never merged into current data.
  for (const [k, val] of Object.entries(src)) {
    if (typeof val === "string") out[k] = val;
    else if (Array.isArray(val)) out[k] = val.map((x) => str(x)).filter(Boolean);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The canonical, normalized intake data blob (the single source of truth). */
export function normalizeIntakeData(input: unknown): Record<string, unknown> {
  const src = asRecord(input);
  const out: Record<string, unknown> = {};

  // Step 1 — business (top-level, current values are authoritative).
  const contact = textOrNull(src.contact_name, LIMITS.name);
  const business = textOrNull(src.business_name, LIMITS.business);
  const email = normalizeEmail(src.email);
  const phone = textOrNull(src.phone, LIMITS.phone); // lenient: kept as entered
  const website = normalizeWebsiteUrl(src.existing_website_url);
  const location = textOrNull(src.location, LIMITS.location);
  if (contact) out.contact_name = contact;
  if (business) out.business_name = business;
  if (email) out.email = email;
  if (phone) out.phone = phone;
  if (website) out.existing_website_url = website;
  if (location) out.location = location;

  // Step 2 — services + uncertainty exclusivity.
  const selected: ServiceType[] = normalizeServiceSelection(
    Array.isArray(src.selected_services) ? (src.selected_services as string[]) : []
  );
  let uncertain = src[SERVICES_UNCERTAIN_KEY] === true;
  if (selected.length > 0) uncertain = false; // a real service clears uncertainty
  out.selected_services = uncertain ? [] : selected; // uncertainty clears services
  out[SERVICES_UNCERTAIN_KEY] = uncertain;

  // Step 3 — service details. Kept regardless of current selection so answers
  // are NOT erased when a service is deselected (UI/carry-over scope them later).
  const goalPrimary = pickEnum(src.website_goal_primary, WEBSITE_GOAL_OPTIONS);
  if (goalPrimary) out.website_goal_primary = goalPrimary;
  const gads = pickEnum(src.google_ads_running, RUNNING_OPTIONS);
  if (gads) out.google_ads_running = gads;
  const meta = pickEnum(src.meta_ads_running, RUNNING_OPTIONS);
  if (meta) out.meta_ads_running = meta;
  const handles = textOrNull(src.meta_social_handles, LIMITS.handles);
  if (handles) out.meta_social_handles = handles;
  const keywords = normalizeList(src.keywords, LIMITS.keywordItem, LIMITS.keywords);
  if (keywords.length > 0) out.keywords = keywords;

  // Step 4 — goals.
  const goals = normalizeList(src.goals, 60, LIMITS.goals).filter((g) =>
    (GOAL_OPTIONS as readonly string[]).includes(g)
  );
  if (goals.length > 0) out.goals = goals;
  const goalsNote = textOrNull(src.goals_note, LIMITS.note);
  if (goalsNote) out.goals_note = goalsNote;

  // Step 5 — budget & timing.
  const invest = pickEnum(src.investment_band, INVESTMENT_OPTIONS);
  if (invest) out.investment_band = invest;
  const readiness = pickEnum(src.readiness, READINESS_OPTIONS);
  if (readiness) out.readiness = readiness;

  // Reserved metadata — preserved, never authoritative for current values.
  const prefill = normalizePrefill(src[PREFILL_KEY]);
  if (prefill) out[PREFILL_KEY] = prefill;

  return out;
}

export interface PromotedColumns {
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  selected_services: string[];
}

/**
 * Derive the prospect_intakes promoted columns from ALREADY-normalized data.
 * The single place columns come from — guarantees they never drift from `data`.
 */
export function derivePromotedColumns(data: Record<string, unknown>): PromotedColumns {
  return {
    business_name: typeof data.business_name === "string" ? data.business_name : null,
    contact_name: typeof data.contact_name === "string" ? data.contact_name : null,
    email: typeof data.email === "string" ? data.email : null,
    phone: typeof data.phone === "string" ? data.phone : null,
    selected_services: Array.isArray(data.selected_services)
      ? (data.selected_services as string[])
      : [],
  };
}

/** Convenience: normalize input and derive columns together (what servers call). */
export function normalizeIntake(input: unknown): {
  data: Record<string, unknown>;
  columns: PromotedColumns;
} {
  const data = normalizeIntakeData(input);
  return { data, columns: derivePromotedColumns(data) };
}

/** Keys a browser autosave patch is allowed to touch — form fields + services. */
const PATCHABLE_KEYS: ReadonlySet<string> = new Set<string>([
  ...KNOWN_FIELD_NAMES,
  SELECTED_SERVICES_KEY,
  SERVICES_UNCERTAIN_KEY,
]);

/**
 * The partial-save contract (P2-C will use this — NEVER normalizeIntakeData(patch)).
 *
 * Merge a bounded, untrusted browser PATCH onto the EXISTING canonical data,
 * then normalize the COMPLETE merged object — so a partial autosave can never
 * erase answers from other sections. Only patchable form/service keys are
 * applied; unknown keys and reserved server-owned metadata (any "_"-prefixed
 * key, e.g. _prefill) in the patch are ignored, and existing reserved metadata
 * is preserved. Caller derives promoted columns from the returned data.
 */
export function mergeIntakePatch(
  existingData: unknown,
  patch: unknown
): Record<string, unknown> {
  const base = asRecord(existingData); // sanitized current data (keeps _prefill)
  const p = asRecord(patch);
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(p)) {
    if (isReservedIntakeKey(key)) continue; // client can never touch _prefill etc.
    if (!PATCHABLE_KEYS.has(key)) continue; // only form/service keys
    merged[key] = value;
  }
  // Reserved metadata stays server-owned: base's _prefill is retained (the patch
  // could not overwrite it above), and normalize preserves it.
  return normalizeIntakeData(merged);
}
