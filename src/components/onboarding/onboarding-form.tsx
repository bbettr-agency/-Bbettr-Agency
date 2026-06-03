"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Save, Send, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, FieldHelp } from "@/components/ui/input";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { saveOnboarding, type OnboardingState } from "@/app/(client)/dashboard/onboarding/actions";
import type { ServiceDefinition, OnboardingField } from "@/lib/services";
import type { FileRecord } from "@/lib/database.types";

type FormValues = Record<string, unknown>;

interface OnboardingFormProps {
  clientId: string;
  service: ServiceDefinition;
  initialData: FormValues;
  readOnly?: boolean;
  /** Called after a successful final submission (not draft saves). */
  onSubmitted?: (result: OnboardingState) => void;
}

export function OnboardingForm({
  clientId,
  service,
  initialData,
  readOnly = false,
  onSubmitted,
}: OnboardingFormProps) {
  const [values, setValues] = useState<FormValues>(initialData ?? {});
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const setField = (name: string, value: unknown) =>
    setValues((v) => ({ ...v, [name]: value }));

  function submit(finalise: boolean) {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveOnboarding(service.id, values, finalise);
      if (res.error) {
        setFeedback(res.error);
        return;
      }
      if (finalise) {
        setFeedback(
          res.allComplete
            ? "All onboarding complete — taking you to your dashboard…"
            : "Onboarding submitted — moving you to the next service…"
        );
        // Brief pause so the confirmation is visible, then hand off to the
        // parent to advance to the next service or the dashboard.
        if (onSubmitted) {
          const result = res;
          setTimeout(() => onSubmitted(result), 900);
        }
      } else {
        setFeedback("Draft saved.");
      }
    });
  }

  return (
    <div className="space-y-8">
      {service.sections.map((section) => (
        <div key={section.title}>
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-ink-900">
              {section.title}
            </h3>
            {section.description && (
              <p className="mt-0.5 text-sm text-ink-500">{section.description}</p>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {section.fields.map((field) => (
              <div
                key={field.name}
                className={cn(
                  field.type === "textarea" ||
                    field.type === "checkbox-group" ||
                    field.type === "file" ||
                    field.type === "multitext"
                    ? "sm:col-span-2"
                    : ""
                )}
              >
                <FieldRenderer
                  clientId={clientId}
                  field={field}
                  value={values[field.name]}
                  onChange={(v) => setField(field.name, v)}
                  readOnly={readOnly}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-ink-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
          {feedback && (
            <p className="flex items-center gap-2 text-sm text-ink-600">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {feedback}
            </p>
          )}
          <div className="flex gap-3 sm:ml-auto">
            <Button
              variant="outline"
              loading={pending}
              onClick={() => submit(false)}
            >
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button loading={pending} onClick={() => submit(true)}>
              <Send className="h-4 w-4" /> Submit onboarding
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRenderer({
  clientId,
  field,
  value,
  onChange,
  readOnly,
}: {
  clientId: string;
  field: OnboardingField;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly: boolean;
}) {
  const id = `f-${field.name}`;

  if (field.type === "textarea") {
    return (
      <div>
        <Label htmlFor={id} required={field.required}>
          {field.label}
        </Label>
        <Textarea
          id={id}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.help && <FieldHelp>{field.help}</FieldHelp>}
      </div>
    );
  }

  if (field.type === "color") {
    return (
      <div>
        <Label htmlFor={id} required={field.required}>
          {field.label}
        </Label>
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="color"
            value={(value as string) || "#38B6FF"}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 w-14 cursor-pointer rounded-xl border border-ink-200 bg-white p-1"
          />
          <Input
            value={(value as string) ?? ""}
            placeholder="#38B6FF"
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
        </div>
        {field.help && <FieldHelp>{field.help}</FieldHelp>}
      </div>
    );
  }

  if (field.type === "multitext") {
    return (
      <MultiText
        field={field}
        value={(value as string[]) ?? []}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }

  if (field.type === "checkbox-group") {
    const selected = (value as string[]) ?? [];
    return (
      <div>
        <Label required={field.required}>{field.label}</Label>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  onChange(
                    checked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt]
                  )
                }
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  checked
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {field.help && <FieldHelp>{field.help}</FieldHelp>}
      </div>
    );
  }

  if (field.type === "file") {
    const uploaded = (value as { name: string; path: string }[]) ?? [];
    return (
      <div>
        <Label required={field.required}>{field.label}</Label>
        {!readOnly && (
          <FileDropzone
            clientId={clientId}
            onUploaded={(rec: FileRecord) =>
              onChange([...uploaded, { name: rec.name, path: rec.path }])
            }
          />
        )}
        {uploaded.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-ink-600">
            {uploaded.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {f.name}
              </li>
            ))}
          </ul>
        )}
        {field.help && <FieldHelp>{field.help}</FieldHelp>}
      </div>
    );
  }

  // text / email / tel / url / number
  return (
    <div>
      <Label htmlFor={id} required={field.required}>
        {field.label}
      </Label>
      <Input
        id={id}
        type={field.type === "number" ? "number" : field.type}
        placeholder={field.placeholder}
        value={(value as string) ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <FieldHelp>{field.help}</FieldHelp>}
    </div>
  );
}

function MultiText({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: OnboardingField;
  value: string[];
  onChange: (v: string[]) => void;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...value, v]);
    setDraft("");
  };

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder={field.placeholder ?? "Type and press Add"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" size="icon" onClick={add}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-sm text-ink-700"
            >
              {item}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  className="text-ink-400 hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {field.help && <FieldHelp>{field.help}</FieldHelp>}
    </div>
  );
}
