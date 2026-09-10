/**
 * Schema-driven presenter for a SUBMITTED onboarding submission (UX polish).
 *
 * Turns the stored `onboarding_submissions.data` JSONB into an ordered,
 * human-labelled view model that reads like a concise client brief — NOT a
 * key/value database dump. The schema in `src/lib/services.ts` is the single
 * source of truth for section order/titles, field order, human labels, field
 * types, and conditional visibility (`visibleWhen`). Empty answers are dropped;
 * `note` fields and `review` sections are skipped.
 *
 * "Preserve all answers": any stored key NOT represented in the current schema
 * (e.g. a superseded/legacy field) is not silently dropped and is never shown as
 * raw JSON — it surfaces in a final "Additional details" section with a
 * title-cased label. Pure: no I/O, no JSX.
 */
import { getService, type OnboardingField, type VisibleWhen } from "@/lib/services";
import type { ServiceType } from "@/lib/database.types";

export type ValueKind =
  | "text"
  | "longtext"
  | "email"
  | "tel"
  | "url"
  | "color"
  | "list"
  | "files"
  | "group";

export interface PresentedRow {
  label: string;
  kind: ValueKind;
  text?: string;
  items?: string[];
  files?: string[];
  /** group-list: one array of rows per entry. */
  entries?: PresentedRow[][];
  /** Layout hint: span the full content width (long text, lists, files, groups). */
  full: boolean;
}
export interface PresentedSection {
  title: string;
  description?: string;
  rows: PresentedRow[];
}
export interface PresentedOnboarding {
  sections: PresentedSection[];
  hasContent: boolean;
}

// ── answered / visibility (mirrors onboarding-form's isFilled/matches) ────────
function isAnswered(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}
function matches(cond: VisibleWhen, data: Record<string, unknown>): boolean {
  const v = data[cond.field];
  if (cond.includes !== undefined) return Array.isArray(v) && (v as unknown[]).includes(cond.includes);
  if (cond.equals !== undefined) return v === cond.equals;
  return isAnswered(v);
}
const visible = (vw: VisibleWhen | undefined, data: Record<string, unknown>) => (vw ? matches(vw, data) : true);

// ── value coercion ────────────────────────────────────────────────────────────
const asString = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : String(v));
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).map(asString).filter((s) => s.trim() !== "") : [];
function fileNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v as unknown[]) {
    if (item && typeof item === "object" && "name" in (item as object)) out.push(asString((item as { name: unknown }).name));
    else if (typeof item === "string") out.push(item);
  }
  return out.filter((s) => s.trim() !== "");
}
function normalizeBool(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  const s = asString(v).trim().toLowerCase();
  if (s === "yes" || s === "true") return "Yes";
  if (s === "no" || s === "false") return "No";
  return asString(v);
}
function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const FULL: ReadonlySet<ValueKind> = new Set(["longtext", "list", "files", "group"]);
function mkRow(label: string, kind: ValueKind, extra: Partial<PresentedRow>): PresentedRow {
  return { label, kind, full: FULL.has(kind), ...extra };
}

/** Build a row for one schema field, or null when unanswered / non-answer. */
function presentField(field: OnboardingField, value: unknown): PresentedRow | null {
  if (field.type === "note") return null;
  if (!isAnswered(value)) return null;
  switch (field.type) {
    case "boolean":
      return mkRow(field.label, "text", { text: normalizeBool(value) });
    case "email":
      return mkRow(field.label, "email", { text: asString(value).trim() });
    case "tel":
      return mkRow(field.label, "tel", { text: asString(value).trim() });
    case "url":
      return mkRow(field.label, "url", { text: asString(value).trim() });
    case "color":
      return mkRow(field.label, "color", { text: asString(value).trim() });
    case "textarea":
      return mkRow(field.label, "longtext", { text: asString(value) });
    case "multitext":
    case "checkbox-group": {
      const items = asList(value);
      return items.length ? mkRow(field.label, "list", { items }) : null;
    }
    case "file": {
      const files = fileNames(value);
      return files.length ? mkRow(field.label, "files", { files }) : null;
    }
    case "group-list": {
      if (!Array.isArray(value)) return null;
      const entries: PresentedRow[][] = [];
      for (const item of value as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const rows: PresentedRow[] = [];
        for (const sf of field.subFields ?? []) {
          const r = presentField(sf, obj[sf.name]);
          if (r) rows.push(r);
        }
        if (rows.length) entries.push(rows);
      }
      return entries.length ? mkRow(field.label, "group", { entries }) : null;
    }
    default: // text, select, choice-cards, number
      return mkRow(field.label, "text", { text: asString(value) });
  }
}

/** Present a submission as ordered, labelled sections (schema-driven). */
export function presentOnboarding(
  service: ServiceType,
  data: Record<string, unknown> | null | undefined
): PresentedOnboarding {
  const def = getService(service);
  const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};

  const sections: PresentedSection[] = [];
  const known = new Set<string>();

  for (const section of def.sections) {
    for (const f of section.fields) known.add(f.name);
    if (section.review) continue;
    if (!visible(section.visibleWhen, d)) continue;
    const rows: PresentedRow[] = [];
    for (const field of section.fields) {
      if (!visible(field.visibleWhen, d)) continue;
      const r = presentField(field, d[field.name]);
      if (r) rows.push(r);
    }
    if (rows.length) sections.push({ title: section.title, description: section.description, rows });
  }

  // Preserve any legacy/unexpected answers WITHOUT a raw-JSON dump.
  const extra: PresentedRow[] = [];
  for (const [key, value] of Object.entries(d)) {
    if (known.has(key) || key.startsWith("_") || !isAnswered(value)) continue;
    const label = titleCase(key);
    if (Array.isArray(value)) {
      const files = fileNames(value);
      if (files.length && files.length === (value as unknown[]).length) extra.push(mkRow(label, "files", { files }));
      else {
        const items = asList(value);
        if (items.length) extra.push(mkRow(label, "list", { items }));
      }
    } else if (typeof value === "object") {
      continue; // never render an arbitrary object as JSON
    } else {
      extra.push(mkRow(label, "text", { text: asString(value) }));
    }
  }
  if (extra.length) sections.push({ title: "Additional details", description: "Other information on file.", rows: extra });

  return { sections, hasContent: sections.length > 0 };
}
