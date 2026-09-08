"use client";

import { useId, useRef, useState } from "react";
import { Check, Plus, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Textarea, Label, FieldHelp } from "@/components/ui/input";
import type { SaveStatus } from "@/lib/prospect/intake-flow-machine";

/**
 * Public-intake field components (P2-D). Deliberately light and self-contained
 * — no authenticated-onboarding dependencies (no uploads, no delivery-stage
 * complexity). Selection controls are built on NATIVE inputs (visually hidden +
 * styled labels) so keyboard operation, focus, and screen-reader semantics come
 * for free; selected state is never colour-only (a check icon + ring + border).
 * Errors are associated with their control via aria-describedby / aria-invalid.
 */

// ── Inline field error (associated via id) ───────────────────────────────────
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1 text-xs font-medium text-red-600">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ── Text-like field ──────────────────────────────────────────────────────────
export function TextField({
  label,
  name,
  type = "text",
  value,
  onChange,
  onBlur,
  required,
  help,
  error,
  autoComplete,
  inputMode,
  maxLength,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "tel" | "url";
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  required?: boolean;
  help?: string;
  error?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "url";
  maxLength?: number;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [error ? errId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn("h-12 text-base", error && "border-red-400 focus-visible:border-red-400 focus-visible:ring-red-100")}
      />
      {help && !error && <FieldHelp id={helpId}>{help}</FieldHelp>}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

export function TextareaField({
  label,
  name,
  value,
  onChange,
  onBlur,
  help,
  error,
  maxLength,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  help?: string;
  error?: string;
  maxLength?: number;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        name={name}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(error && "border-red-400")}
      />
      {help && !error && <FieldHelp>{help}</FieldHelp>}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

// ── Selectable card (radio OR checkbox) ──────────────────────────────────────
function SelectableCard({
  type,
  name,
  checked,
  onChange,
  title,
  description,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description?: string;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input
        type={type}
        name={name}
        className="peer sr-only"
        checked={checked}
        onChange={onChange}
      />
      <div
        className={cn(
          "flex min-h-[3.25rem] items-center rounded-xl border border-ink-200 bg-white px-4 py-3 pr-10 text-sm shadow-sm transition-colors",
          "hover:border-ink-300",
          "peer-checked:border-brand-500 peer-checked:bg-brand-50",
          "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2"
        )}
      >
        <span>
          <span className="block font-medium text-ink-900">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
        </span>
      </div>
      <Check
        className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600 opacity-0 transition-opacity peer-checked:opacity-100"
        aria-hidden
      />
    </label>
  );
}

// ── Single-select choice cards (native radios in a fieldset) ─────────────────
export function ChoiceCardGroup({
  legend,
  name,
  options,
  value,
  onChange,
  help,
  error,
}: {
  legend: string;
  name: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  help?: string;
  error?: string;
}) {
  const errId = useId();
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}>
      <legend className="mb-1.5 block text-sm font-medium text-ink-700">{legend}</legend>
      {help && !error && <FieldHelp className="mb-2 mt-0">{help}</FieldHelp>}
      <div className="mt-2 grid gap-2.5">
        {options.map((opt) => (
          <SelectableCard
            key={opt}
            type="radio"
            name={name}
            title={opt}
            checked={value === opt}
            // Clicking the selected radio again clears it (optional single-select).
            onChange={() => onChange(value === opt ? "" : opt)}
          />
        ))}
      </div>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}

// ── Multi-select chips (native checkboxes) ───────────────────────────────────
export function ChipGroup({
  legend,
  name,
  options,
  value,
  onToggle,
  error,
}: {
  legend: string;
  name: string;
  options: readonly string[];
  value: string[];
  onToggle: (opt: string) => void;
  error?: string;
}) {
  const errId = useId();
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}>
      <legend className="mb-2.5 block text-sm font-medium text-ink-700">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const on = value.includes(opt);
          return (
            <label key={opt} className="relative cursor-pointer">
              <input
                type="checkbox"
                name={name}
                className="peer sr-only"
                checked={on}
                onChange={() => onToggle(opt)}
              />
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-sm text-ink-700 transition-colors",
                  "hover:border-ink-300",
                  "peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-ink-900",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2"
                )}
              >
                {on && <Check className="h-3.5 w-3.5 text-brand-600" aria-hidden />}
                {opt}
              </span>
            </label>
          );
        })}
      </div>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </fieldset>
  );
}

// ── Multitext (simple add/remove list) ───────────────────────────────────────
export function Multitext({
  label,
  value,
  onChange,
  placeholder,
  itemMaxLength,
  max,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  itemMaxLength?: number;
  max?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const atMax = typeof max === "number" && value.length >= max;

  function add() {
    const t = draft.trim();
    if (!t || atMax) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          ref={inputRef}
          value={draft}
          placeholder={placeholder}
          maxLength={itemMaxLength}
          disabled={atMax}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-12 text-base"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || atMax}
          className="inline-flex h-12 shrink-0 items-center gap-1 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
      </div>
      {value.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {value.map((item) => (
            <li key={item}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-ink-50 py-1.5 pl-3 pr-1.5 text-sm text-ink-800">
                {item}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== item))}
                  aria-label={`Remove ${item}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-200 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Autosave status pill (aria-live, non-layout-shifting) ────────────────────
export function SaveStatusPill({ status }: { status: SaveStatus }) {
  return (
    <span
      aria-live="polite"
      className="inline-flex min-h-[1.25rem] items-center gap-1.5 text-xs text-ink-400"
    >
      {status === "saving" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
        </>
      )}
      {status === "saved" && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> Saved
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Couldn&rsquo;t save
        </>
      )}
    </span>
  );
}
