"use client";

import { cn } from "@/lib/utils";

export interface ChoiceCardOption {
  /** The value stored when this option is chosen. */
  value: string;
  /** Display title. Falls back to `value`. */
  label?: string;
  /** Optional plain-language sub-text shown under the title. */
  description?: string;
}

const COLUMN_CLASSES: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Generic single-select card group — a reusable design-system primitive for
 * onboarding forms, settings pages and any configuration screen. Presentation
 * only; the caller owns the value.
 *
 * Responsive: stacks to one column on mobile, grids on larger screens.
 * Accessible: real <button>s in a labelled group — Tab moves between options,
 * Space/Enter selects, and a visible focus ring matches the rest of the portal.
 * Uses the same button + aria-pressed pattern as the other selectable controls
 * in the app so it feels native rather than bespoke.
 */
export function ChoiceCards({
  options,
  value,
  onChange,
  columns = 2,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
}: {
  options: ChoiceCardOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** Grid columns from `sm` upward (mobile is always a single column). */
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("grid gap-2.5", COLUMN_CLASSES[columns])}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-brand-500 bg-brand-50"
                : "border-ink-200 bg-white hover:border-ink-300"
            )}
          >
            <span className="block text-sm font-semibold text-ink-900">
              {opt.label ?? opt.value}
            </span>
            {opt.description && (
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                {opt.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
