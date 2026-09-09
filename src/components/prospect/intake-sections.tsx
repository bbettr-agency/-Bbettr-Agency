"use client";

import Link from "next/link";
import type { ServiceType } from "@/lib/database.types";
import {
  BUSINESS_FIELDS,
  SERVICE_FIELDS,
  GOALS_FIELDS,
  BUDGET_FIELDS,
  GOAL_OPTIONS,
  LIMITS,
  REVIEW_GROUPS,
  SELECTED_SERVICES_KEY,
  SERVICES_UNCERTAIN_KEY,
  type PublicField,
} from "@/lib/prospect/intake-schema";
import { INTAKE_SERVICE_IDS } from "@/lib/prospect/intake-lifecycle";
import type { FieldErrors } from "@/lib/prospect/intake-validation";
import {
  TextField,
  TextareaField,
  ChoiceCardGroup,
  ChipGroup,
  Multitext,
} from "./intake-fields";
import { Check, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

// Single source of truth for service display names (also used by the admin
// Intakes surface); imported for local use + re-exported for existing importers.
import { SERVICE_LABELS } from "@/lib/prospect/intake-present";
export { SERVICE_LABELS };

type Data = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]).map(String) : []);

interface SectionProps {
  data: Data;
  errors: FieldErrors;
  update: (patch: Data) => void;
  onBlurSave?: () => void;
}

// ── 1. Business ───────────────────────────────────────────────────────────────
const AUTO: Record<string, string> = {
  contact_name: "name",
  business_name: "organization",
  email: "email",
  phone: "tel",
  existing_website_url: "url",
  location: "address-level2",
};
const INPUT_MODE: Record<string, "text" | "email" | "tel" | "url"> = {
  email: "email",
  phone: "tel",
  existing_website_url: "url",
};

export function BusinessSection({ data, errors, update, onBlurSave }: SectionProps) {
  return (
    <div className="grid gap-5">
      {BUSINESS_FIELDS.map((f: PublicField) => (
        <TextField
          key={f.name}
          label={f.label}
          name={f.name}
          type={(f.type === "email" || f.type === "tel" || f.type === "url" ? f.type : "text")}
          inputMode={INPUT_MODE[f.name]}
          autoComplete={AUTO[f.name]}
          maxLength={f.maxLength}
          required={f.required}
          value={str(data[f.name])}
          error={errors[f.name]}
          onChange={(v) => update({ [f.name]: v })}
          onBlur={onBlurSave}
        />
      ))}
    </div>
  );
}

// ── 2. Services ───────────────────────────────────────────────────────────────
export function ServicesSection({ data, errors, update }: SectionProps) {
  const selected = arr(data[SELECTED_SERVICES_KEY]);
  const uncertain = data[SERVICES_UNCERTAIN_KEY] === true;

  function toggleService(id: ServiceType) {
    const has = selected.includes(id);
    const next = has ? selected.filter((s) => s !== id) : [...selected, id];
    // Choosing a real service clears "not sure yet".
    update({ [SELECTED_SERVICES_KEY]: next, [SERVICES_UNCERTAIN_KEY]: false });
  }
  function chooseUnsure() {
    // "Not sure yet" is exclusive — it clears any selected services.
    update({ [SELECTED_SERVICES_KEY]: [], [SERVICES_UNCERTAIN_KEY]: !uncertain });
  }

  return (
    <fieldset aria-invalid={errors.selected_services ? true : undefined}>
      <legend className="sr-only">What would you like help with?</legend>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {INTAKE_SERVICE_IDS.map((id) => {
          const on = selected.includes(id);
          return (
            <label key={id} className="relative block cursor-pointer">
              <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggleService(id)} />
              <div
                className={cn(
                  "flex min-h-[3.5rem] items-center rounded-xl border border-ink-200 bg-white px-4 py-3 pr-10 font-medium text-ink-900 shadow-sm transition-colors",
                  "hover:border-ink-300",
                  "peer-checked:border-brand-500 peer-checked:bg-brand-50",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2"
                )}
              >
                {SERVICE_LABELS[id]}
              </div>
              <Check
                className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600 opacity-0 peer-checked:opacity-100"
                aria-hidden
              />
            </label>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="relative block cursor-pointer">
          <input type="checkbox" className="peer sr-only" checked={uncertain} onChange={chooseUnsure} />
          <div
            className={cn(
              "flex min-h-[3rem] items-center rounded-xl border border-dashed border-ink-300 bg-white px-4 py-3 pr-10 text-sm text-ink-700 transition-colors",
              "hover:border-ink-400",
              "peer-checked:border-brand-500 peer-checked:border-solid peer-checked:bg-brand-50 peer-checked:text-ink-900",
              "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2"
            )}
          >
            I&rsquo;m not sure yet — help me figure it out
          </div>
          <Check
            className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600 opacity-0 peer-checked:opacity-100"
            aria-hidden
          />
        </label>
      </div>

      {errors.selected_services && (
        <p className="mt-2 text-xs font-medium text-red-600">{errors.selected_services}</p>
      )}
    </fieldset>
  );
}

// ── 3. Service details (single service mini-panel) ───────────────────────────
export function ServiceDetailPanel({
  service,
  data,
  errors,
  update,
  onBlurSave,
}: SectionProps & { service: ServiceType }) {
  const fields = SERVICE_FIELDS[service];
  return (
    <div className="grid gap-5">
      {fields.map((f) => {
        if (f.type === "choice-cards") {
          return (
            <ChoiceCardGroup
              key={f.name}
              legend={f.label}
              name={f.name}
              options={f.options ?? []}
              value={str(data[f.name])}
              error={errors[f.name]}
              onChange={(v) => update({ [f.name]: v })}
            />
          );
        }
        if (f.type === "multitext") {
          return (
            <Multitext
              key={f.name}
              label={f.label}
              value={arr(data[f.name])}
              itemMaxLength={LIMITS.keywordItem}
              max={LIMITS.keywords}
              placeholder="e.g. emergency plumber Cape Town"
              onChange={(next) => update({ [f.name]: next })}
            />
          );
        }
        return (
          <TextField
            key={f.name}
            label={f.label}
            name={f.name}
            maxLength={f.maxLength}
            value={str(data[f.name])}
            error={errors[f.name]}
            onChange={(v) => update({ [f.name]: v })}
            onBlur={onBlurSave}
          />
        );
      })}
    </div>
  );
}

// ── 4. Goals ──────────────────────────────────────────────────────────────────
export function GoalsSection({ data, errors, update, onBlurSave }: SectionProps) {
  const goals = arr(data.goals);
  return (
    <div className="grid gap-5">
      <ChipGroup
        legend={GOALS_FIELDS[0].label}
        name="goals"
        options={GOAL_OPTIONS}
        value={goals}
        error={errors.goals}
        onToggle={(opt) =>
          update({ goals: goals.includes(opt) ? goals.filter((g) => g !== opt) : [...goals, opt] })
        }
      />
      <TextareaField
        label={GOALS_FIELDS[1].label}
        name="goals_note"
        maxLength={LIMITS.note}
        value={str(data.goals_note)}
        error={errors.goals_note}
        onChange={(v) => update({ goals_note: v })}
        onBlur={onBlurSave}
      />
    </div>
  );
}

// ── 5. Budget & timing ─────────────────────────────────────────────────────────
export function BudgetSection({ data, errors, update }: SectionProps) {
  return (
    <div className="grid gap-6">
      {BUDGET_FIELDS.map((f) => (
        <ChoiceCardGroup
          key={f.name}
          legend={f.label}
          name={f.name}
          help={f.help}
          options={f.options ?? []}
          value={str(data[f.name])}
          error={errors[f.name]}
          onChange={(v) => update({ [f.name]: v })}
        />
      ))}
    </div>
  );
}

// ── 6. Review ──────────────────────────────────────────────────────────────────
function reviewValue(data: Data, fieldName: string): string {
  if (fieldName === SELECTED_SERVICES_KEY) {
    const sel = arr(data[SELECTED_SERVICES_KEY]).filter((s): s is ServiceType =>
      (INTAKE_SERVICE_IDS as readonly string[]).includes(s)
    );
    return sel.map((s) => SERVICE_LABELS[s]).join(", ");
  }
  if (fieldName === SERVICES_UNCERTAIN_KEY) {
    return data[SERVICES_UNCERTAIN_KEY] === true ? "Not sure yet" : "";
  }
  const v = data[fieldName];
  if (Array.isArray(v)) return v.map(String).join(", ");
  return str(v);
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...BUSINESS_FIELDS, ...GOALS_FIELDS, ...BUDGET_FIELDS, ...Object.values(SERVICE_FIELDS).flat()].map(
    (f) => [f.name, f.label]
  )
);

export function ReviewSection({
  data,
  onEdit,
  readOnly = false,
}: {
  data: Data;
  onEdit?: (section: (typeof REVIEW_GROUPS)[number]["section"]) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-4">
      {REVIEW_GROUPS.map((group) => {
        const rows = group.fieldNames
          .map((name) => ({ name, label: FIELD_LABELS[name] ?? name, value: reviewValue(data, name) }))
          .filter((r) => r.value);
        // Details group is hidden entirely when there is nothing to show.
        if (rows.length === 0 && group.section !== "business") return null;
        return (
          <div key={group.section} className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-ink-900">{group.label}</h3>
              {!readOnly && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(group.section)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Pencil className="h-3 w-3" aria-hidden /> Edit
                </button>
              )}
            </div>
            <dl className="mt-3 grid gap-2">
              {rows.length === 0 ? (
                <p className="text-sm text-ink-400">Not added</p>
              ) : (
                rows.map((r) => (
                  <div key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 text-sm">
                    <dt className="text-ink-500">{r.label}</dt>
                    <dd className="break-words text-ink-900">{r.value}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>
        );
      })}
      {!readOnly && (
        <p className="px-1 text-xs text-ink-400">
          By sending this you agree to us contacting you about your enquiry. See our{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-600">
            privacy policy
          </Link>
          .
        </p>
      )}
    </div>
  );
}
