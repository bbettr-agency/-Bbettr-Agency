"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Save,
  Send,
  Plus,
  X,
  Trash2,
  ChevronDown,
  Circle,
  CircleDashed,
  Info,
  HelpCircle,
  CalendarClock,
  PencilLine,
  LifeBuoy,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, FieldHelp } from "@/components/ui/input";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { saveOnboarding, type OnboardingState } from "@/app/(client)/dashboard/onboarding/actions";
import {
  TECHNICAL_FIELD_HELP,
  ONBOARDING_CALL_PLATFORMS,
  type ServiceDefinition,
  type OnboardingField,
  type OnboardingSection,
  type VisibleWhen,
} from "@/lib/services";
import type { FileRecord } from "@/lib/database.types";

type FormValues = Record<string, unknown>;
type SectionStatus = "not_started" | "in_progress" | "completed";
type OnboardingMode = "self" | "schedule";

interface BookingData {
  platform?: string;
  date?: string;
  time?: string;
  contact_method?: string;
  contact_details?: string;
  notes?: string;
}

/** Reserved keys stored alongside field answers in onboarding_submissions.data. */
const MODE_KEY = "__mode";
const BOOKING_KEY = "__booking";

/** Sentinel stored when a client marks a technical field "Not sure". */
const NOT_SURE = "Not sure — please assist";

const REASSURANCE =
  "Don't worry if you're unsure about some questions. Complete what you can and our team will assist with the rest.";

const CONTACT_METHODS = ["Phone Call", "WhatsApp", "Email"];

const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL;

const isTechnical = (name: string) => name in TECHNICAL_FIELD_HELP;

interface OnboardingFormProps {
  clientId: string;
  service: ServiceDefinition;
  initialData: FormValues;
  readOnly?: boolean;
  onSubmitted?: (result: OnboardingState) => void;
}

const FULL_WIDTH_TYPES = new Set([
  "textarea",
  "checkbox-group",
  "file",
  "multitext",
  "group-list",
  "note",
]);

// ── Value helpers ────────────────────────────────────────────────────────────

function isFilled(field: OnboardingField, value: unknown): boolean {
  if (field.type === "note") return true;
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function matches(cond: VisibleWhen, values: FormValues): boolean {
  const v = values[cond.field];
  if (cond.includes !== undefined) {
    return Array.isArray(v) && (v as unknown[]).includes(cond.includes);
  }
  if (cond.equals !== undefined) return v === cond.equals;
  return isFilled({ name: cond.field, label: "", type: "text" }, v);
}

function fieldVisible(field: OnboardingField, values: FormValues): boolean {
  return !field.visibleWhen || matches(field.visibleWhen, values);
}

function sectionVisible(section: OnboardingSection, values: FormValues): boolean {
  return !section.visibleWhen || matches(section.visibleWhen, values);
}

/** Visible, fillable fields in a section (excludes notes). */
function inputFields(section: OnboardingSection, values: FormValues): OnboardingField[] {
  return section.fields.filter(
    (f) => f.type !== "note" && fieldVisible(f, values)
  );
}

function requiredOk(section: OnboardingSection, values: FormValues): boolean {
  return inputFields(section, values)
    .filter((f) => f.required)
    .every((f) => isFilled(f, values[f.name]));
}

function sectionStatus(section: OnboardingSection, values: FormValues): SectionStatus {
  const fields = inputFields(section, values);
  if (fields.length === 0) return "completed";
  const filled = fields.filter((f) => isFilled(f, values[f.name]));
  if (filled.length === 0) return "not_started";
  const required = fields.filter((f) => f.required);
  if (required.length > 0) return requiredOk(section, values) ? "completed" : "in_progress";
  return filled.length === fields.length ? "completed" : "in_progress";
}

// ── Main form ────────────────────────────────────────────────────────────────

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
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Sections that are actually shown (respecting section-level conditionals).
  const sections = useMemo(
    () => service.sections.filter((s) => sectionVisible(s, values)),
    [service.sections, values]
  );

  const [openIdx, setOpenIdx] = useState<Set<number>>(new Set([0]));

  const setField = (name: string, value: unknown) =>
    setValues((v) => ({ ...v, [name]: value }));

  // ── Onboarding mode (self-serve vs. book a session) ──
  const mode: OnboardingMode = values[MODE_KEY] === "schedule" ? "schedule" : "self";
  const booking = (values[BOOKING_KEY] as BookingData) ?? {};
  const setMode = (m: OnboardingMode) => setField(MODE_KEY, m);
  const setBooking = (patch: Partial<BookingData>) =>
    setField(BOOKING_KEY, { ...booking, ...patch });

  const topRef = useRef<HTMLDivElement>(null);
  /** A "Schedule setup call" shortcut on a field jumps to booking, pre-noting it. */
  const scheduleHelpFor = (label: string) => {
    const note = `I'd like help with: ${label}`;
    setValues((v) => {
      const b = (v[BOOKING_KEY] as BookingData) ?? {};
      const notes = b.notes ? `${b.notes}\n${note}` : note;
      return { ...v, [MODE_KEY]: "schedule", [BOOKING_KEY]: { ...b, notes } };
    });
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // ── Progress (required-field based) ──
  const { requiredTotal, requiredFilled } = useMemo(() => {
    let total = 0;
    let filled = 0;
    for (const s of sections) {
      for (const f of inputFields(s, values)) {
        if (!f.required) continue;
        total += 1;
        if (isFilled(f, values[f.name])) filled += 1;
      }
    }
    return { requiredTotal: total, requiredFilled: filled };
  }, [sections, values]);
  const pct = requiredTotal === 0 ? 100 : Math.round((requiredFilled / requiredTotal) * 100);

  // ── Auto-expand the next incomplete section when required fields complete ──
  const prevRequiredOk = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (readOnly) return;
    service.sections.forEach((s, i) => {
      if (s.review || !sectionVisible(s, values)) return;
      const hasRequired = inputFields(s, values).some((f) => f.required);
      if (!hasRequired) return;
      const ok = requiredOk(s, values);
      const was = prevRequiredOk.current[s.title] ?? false;
      if (ok && !was) {
        // This section just satisfied its required fields → guide to the next.
        setOpenIdx((open) => {
          const next = new Set(open);
          next.delete(i);
          const nextIdx = service.sections.findIndex(
            (cand, j) =>
              j > i &&
              sectionVisible(cand, values) &&
              (cand.review || sectionStatus(cand, values) !== "completed")
          );
          if (nextIdx !== -1) next.add(nextIdx);
          return next;
        });
      }
      prevRequiredOk.current[s.title] = ok;
    });
  }, [values, service.sections, readOnly]);

  // ── Debounced auto-save (draft) ──
  const lastSaved = useRef<string>(JSON.stringify(initialData ?? {}));
  useEffect(() => {
    if (readOnly) return;
    const snapshot = JSON.stringify(values);
    if (snapshot === lastSaved.current) return;
    const t = setTimeout(() => {
      setAutosaveState("saving");
      saveOnboarding(service.id, values, false)
        .then((res) => {
          if (!res.error) {
            lastSaved.current = snapshot;
            setAutosaveState("saved");
          } else {
            setAutosaveState("idle");
          }
        })
        .catch(() => setAutosaveState("idle"));
    }, 1200);
    return () => clearTimeout(t);
  }, [values, service.id, readOnly]);

  function toggle(i: number) {
    setOpenIdx((open) => {
      const next = new Set(open);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function submit() {
    setFeedback(null);
    // Validate required fields across visible sections.
    const missing = sections.filter(
      (s) => !s.review && !requiredOk(s, values)
    );
    if (missing.length > 0) {
      setOpenIdx((open) => {
        const next = new Set(open);
        sections.forEach((s, i) => {
          if (!s.review && !requiredOk(s, values)) next.add(i);
        });
        return next;
      });
      setFeedback(
        `Please complete the required fields in: ${missing
          .map((s) => s.title)
          .join(", ")}.`
      );
      return;
    }
    const payload = { ...values, [MODE_KEY]: "self" };
    startTransition(async () => {
      const res = await saveOnboarding(service.id, payload, true);
      if (res.error) {
        setFeedback(res.error);
        return;
      }
      lastSaved.current = JSON.stringify(payload);
      setFeedback(
        res.allComplete
          ? "All onboarding complete — taking you to your dashboard…"
          : "Onboarding submitted — moving you to the next service…"
      );
      if (onSubmitted) {
        const result = res;
        setTimeout(() => onSubmitted(result), 900);
      }
    });
  }

  function saveDraft() {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveOnboarding(service.id, values, false);
      lastSaved.current = JSON.stringify(values);
      setFeedback(res.error ?? "Draft saved.");
    });
  }

  function submitBooking() {
    setFeedback(null);
    if (!booking.platform || !booking.date || !booking.contact_method || !booking.contact_details) {
      setFeedback("Please choose a platform, a preferred date and how we should reach you.");
      return;
    }
    const payload = { ...values, [MODE_KEY]: "schedule" };
    startTransition(async () => {
      const res = await saveOnboarding(service.id, payload, true);
      if (res.error) {
        setFeedback(res.error);
        return;
      }
      lastSaved.current = JSON.stringify(payload);
      setFeedback("Session requested — our team will confirm your booking shortly.");
      if (onSubmitted) {
        const result = res;
        setTimeout(() => onSubmitted(result), 900);
      }
    });
  }

  return (
    <div ref={topRef} className="space-y-4">
      {/* Persistent reassurance — completion over perfection. */}
      {!readOnly && (
        <div className="flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <p className="text-sm text-ink-700">{REASSURANCE}</p>
        </div>
      )}

      <ModeSelector mode={mode} onChange={setMode} readOnly={readOnly} />

      {mode === "schedule" ? (
        <Scheduler
          booking={booking}
          onChange={setBooking}
          onSubmit={submitBooking}
          onBackToSelf={() => setMode("self")}
          pending={pending}
          feedback={feedback}
          readOnly={readOnly}
        />
      ) : (
        <>
      {/* Progress header */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-ink-900">{service.name} onboarding</span>
          <span className="text-ink-500">
            {pct}% complete
            {requiredTotal > 0 && (
              <span className="text-ink-400">
                {" "}· {requiredFilled}/{requiredTotal} required
              </span>
            )}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Accordion sections */}
      {sections.map((section, i) => {
        const status = section.review
          ? requiredTotal === requiredFilled
            ? "completed"
            : "not_started"
          : sectionStatus(section, values);
        const open = openIdx.has(i);
        const stepNo = i + 1;
        return (
          <div
            key={section.title}
            className="overflow-hidden rounded-2xl border border-ink-100 bg-white"
          >
            <button
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <StatusDot status={status} step={stepNo} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">
                  {section.title}
                </span>
                {section.description && (
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {section.description}
                  </span>
                )}
              </span>
              <StatusChip status={status} />
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-ink-400 transition-transform",
                  open && "rotate-180"
                )}
              />
            </button>

            {open && (
              <div className="border-t border-ink-100 p-4 sm:p-5">
                {section.review ? (
                  <ReviewSummary
                    sections={sections.filter((s) => !s.review)}
                    values={values}
                  />
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    {inputFields(section, values).length === 0 &&
                    section.fields.filter((f) => f.type === "note").length === 0 ? (
                      <p className="text-sm text-ink-400">Nothing required here.</p>
                    ) : (
                      section.fields
                        .filter((f) => fieldVisible(f, values))
                        .map((field) => (
                          <div
                            key={field.name}
                            className={cn(FULL_WIDTH_TYPES.has(field.type) && "sm:col-span-2")}
                          >
                            <FieldRenderer
                              clientId={clientId}
                              field={field}
                              value={values[field.name]}
                              onChange={(v) => setField(field.name, v)}
                              readOnly={readOnly}
                              onScheduleHelp={scheduleHelpFor}
                            />
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      {!readOnly && (
        <div className="sticky bottom-0 flex flex-col-reverse items-stretch gap-3 rounded-2xl border border-ink-100 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-ink-600">
            {feedback ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {feedback}
              </>
            ) : autosaveState === "saving" ? (
              <span className="text-ink-400">Saving…</span>
            ) : autosaveState === "saved" ? (
              <span className="text-ink-400">Draft saved automatically.</span>
            ) : null}
          </p>
          <div className="flex gap-3 sm:ml-auto">
            <Button variant="outline" loading={pending} onClick={saveDraft}>
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button loading={pending} onClick={submit}>
              <Send className="h-4 w-4" /> Submit onboarding
            </Button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// ── Mode selection & scheduling ──────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
  readOnly,
}: {
  mode: OnboardingMode;
  onChange: (m: OnboardingMode) => void;
  readOnly: boolean;
}) {
  const options: { id: OnboardingMode; title: string; desc: string; Icon: typeof PencilLine }[] = [
    {
      id: "self",
      title: "Complete onboarding myself",
      desc: "Fill in the form at your own pace. Save and come back anytime.",
      Icon: PencilLine,
    },
    {
      id: "schedule",
      title: "Schedule a session with the Bbettr team",
      desc: "Book a quick call and we'll complete it together — perfect if you're short on time or unsure.",
      Icon: CalendarClock,
    },
  ];

  if (readOnly) {
    const active = options.find((o) => o.id === mode)!;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <active.Icon className="h-5 w-5 text-brand-500" />
        <span className="text-sm text-ink-700">
          Onboarding method: <span className="font-semibold">{active.title}</span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink-900">
        How would you like to complete this onboarding?
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const selected = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
                selected
                  ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100"
                  : "border-ink-200 bg-white hover:border-ink-300"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  selected ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-500"
                )}
              >
                <o.Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900">{o.title}</span>
                <span className="mt-0.5 block text-xs text-ink-500">{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Scheduler({
  booking,
  onChange,
  onSubmit,
  onBackToSelf,
  pending,
  feedback,
  readOnly,
}: {
  booking: BookingData;
  onChange: (patch: Partial<BookingData>) => void;
  onSubmit: () => void;
  onBackToSelf: () => void;
  pending: boolean;
  feedback: string | null;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <div className="space-y-3 rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="text-sm font-semibold text-ink-900">Onboarding session request</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <SummaryRow label="Platform" value={booking.platform} />
          <SummaryRow label="Preferred date" value={booking.date} />
          <SummaryRow label="Preferred time" value={booking.time} />
          <SummaryRow label="Contact method" value={booking.contact_method} />
          <SummaryRow label="Contact details" value={booking.contact_details} />
        </dl>
        {booking.notes && (
          <p className="whitespace-pre-line rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
            {booking.notes}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-start gap-3">
        <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
        <div>
          <h3 className="text-sm font-semibold text-ink-900">
            Need help completing your onboarding?
          </h3>
          <p className="mt-0.5 text-sm text-ink-600">
            Book a Google Meet session with our team and we&apos;ll complete the
            onboarding together.
          </p>
        </div>
      </div>

      {CALENDLY_URL && (
        <a
          href={CALENDLY_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
        >
          <CalendarClock className="h-4 w-4" /> Book instantly via Calendly
        </a>
      )}

      <div>
        <Label required>Preferred platform</Label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ONBOARDING_CALL_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ platform: booking.platform === p ? "" : p })}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                booking.platform === p
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label required>Preferred date</Label>
          <Input
            type="date"
            value={booking.date ?? ""}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </div>
        <div>
          <Label>Preferred time</Label>
          <Input
            type="time"
            value={booking.time ?? ""}
            onChange={(e) => onChange({ time: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label required>How should we reach you?</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {CONTACT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ contact_method: booking.contact_method === m ? "" : m })}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  booking.contact_method === m
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label required>Contact details</Label>
          <Input
            placeholder="Phone number or email"
            value={booking.contact_details ?? ""}
            onChange={(e) => onChange({ contact_details: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label>Anything you&apos;d like help with?</Label>
        <Textarea
          placeholder="Optional — e.g. setting up Google Ads access, connecting my domain…"
          value={booking.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-ink-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onBackToSelf}
          className="text-sm font-medium text-ink-500 hover:text-ink-700"
        >
          ← I&apos;ll complete it myself instead
        </button>
        <div className="flex items-center gap-3">
          {feedback && (
            <span className="flex items-center gap-1.5 text-sm text-ink-600">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {feedback}
            </span>
          )}
          <Button loading={pending} onClick={onSubmit}>
            <CalendarClock className="h-4 w-4" /> Request session
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="text-ink-800">{value || "—"}</dd>
    </div>
  );
}

// ── Status indicators ────────────────────────────────────────────────────────

function StatusDot({ status, step }: { status: SectionStatus; step: number }) {
  if (status === "completed") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        status === "in_progress"
          ? "bg-amber-100 text-amber-700"
          : "bg-ink-100 text-ink-400"
      )}
    >
      {step}
    </span>
  );
}

function StatusChip({ status }: { status: SectionStatus }) {
  const cfg = {
    completed: { label: "Completed", cls: "text-emerald-700 bg-emerald-50", Icon: CheckCircle2 },
    in_progress: { label: "In Progress", cls: "text-amber-700 bg-amber-50", Icon: CircleDashed },
    not_started: { label: "Not Started", cls: "text-ink-400 bg-ink-50", Icon: Circle },
  }[status];
  return (
    <span
      className={cn(
        "hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex",
        cfg.cls
      )}
    >
      <cfg.Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

function ReviewSummary({
  sections,
  values,
}: {
  sections: OnboardingSection[];
  values: FormValues;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-600">
        Here&apos;s where each section stands. Reopen any section above to make
        changes, then submit.
      </p>
      <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
        {sections.map((s) => {
          const status = sectionStatus(s, values);
          return (
            <li key={s.title} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-ink-700">{s.title}</span>
              <StatusChipInline status={status} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusChipInline({ status }: { status: SectionStatus }) {
  const cfg = {
    completed: { label: "Completed", cls: "text-emerald-700" },
    in_progress: { label: "In Progress", cls: "text-amber-700" },
    not_started: { label: "Not Started", cls: "text-ink-400" },
  }[status];
  return <span className={cn("text-xs font-medium", cfg.cls)}>{cfg.label}</span>;
}

// ── Field rendering ──────────────────────────────────────────────────────────

function FieldLabel({ field }: { field: OnboardingField }) {
  if (!field.label) return null;
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <Label required={field.required}>{field.label}</Label>
      <span
        className={cn(
          "shrink-0 text-[10px] font-medium uppercase tracking-wide",
          field.required ? "text-brand-600" : "text-ink-300"
        )}
      >
        {field.required ? "Required" : "Optional"}
      </span>
    </div>
  );
}

function FieldRenderer({
  clientId,
  field,
  value,
  onChange,
  readOnly,
  onScheduleHelp,
}: {
  clientId: string;
  field: OnboardingField;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly: boolean;
  onScheduleHelp?: (label: string) => void;
}) {
  const id = `f-${field.name}`;
  const tech = isTechnical(field.name);

  if (field.type === "note") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        <span>{field.note}</span>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <FieldLabel field={field} />
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

  if (field.type === "select") {
    const notSure = tech && value === NOT_SURE;
    return (
      <div>
        <FieldLabel field={field} />
        <select
          id={id}
          value={notSure ? "" : (value as string) ?? ""}
          disabled={readOnly || notSure}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 shadow-sm focus-visible:outline-none focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-50"
        >
          <option value="">{notSure ? "Marked “Not sure”" : "Select…"}</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {tech ? (
          <TechAssist field={field} value={value} onChange={onChange} onScheduleHelp={onScheduleHelp} showNotSure />
        ) : (
          field.help && <FieldHelp>{field.help}</FieldHelp>
        )}
      </div>
    );
  }

  if (field.type === "boolean") {
    const current = value as string | undefined;
    const opts = tech ? ["Yes", "No", "Not sure"] : ["Yes", "No"];
    return (
      <div>
        <FieldLabel field={field} />
        <div className="flex gap-2">
          {opts.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(current === opt ? "" : opt)}
              className={cn(
                "h-11 flex-1 rounded-xl border text-sm font-medium transition-colors",
                current === opt
                  ? opt === "Not sure"
                    ? "border-amber-400 bg-amber-50 text-amber-700"
                    : "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        {tech ? (
          <TechAssist field={field} onScheduleHelp={onScheduleHelp} />
        ) : (
          field.help && <FieldHelp>{field.help}</FieldHelp>
        )}
      </div>
    );
  }

  if (field.type === "color") {
    return (
      <div>
        <FieldLabel field={field} />
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
        <FieldLabel field={field} />
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
                    checked ? selected.filter((s) => s !== opt) : [...selected, opt]
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

  if (field.type === "group-list") {
    return (
      <GroupList
        clientId={clientId}
        field={field}
        value={(value as Record<string, unknown>[]) ?? []}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }

  if (field.type === "file") {
    const uploaded = (value as { name: string; path: string }[]) ?? [];
    return (
      <div>
        <FieldLabel field={field} />
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
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onChange(uploaded.filter((_, idx) => idx !== i))}
                    className="text-ink-400 hover:text-red-500"
                    aria-label="Remove file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {field.help && <FieldHelp>{field.help}</FieldHelp>}
      </div>
    );
  }

  // text / email / tel / url / number
  const notSure = tech && value === NOT_SURE;
  return (
    <div>
      <FieldLabel field={field} />
      <Input
        id={id}
        type={field.type === "number" ? "number" : field.type}
        placeholder={notSure ? "Marked “Not sure” — we'll assist" : field.placeholder}
        value={notSure ? "" : (value as string) ?? ""}
        disabled={readOnly || notSure}
        onChange={(e) => onChange(e.target.value)}
      />
      {tech ? (
        <TechAssist field={field} value={value} onChange={onChange} onScheduleHelp={onScheduleHelp} showNotSure />
      ) : (
        field.help && <FieldHelp>{field.help}</FieldHelp>
      )}
    </div>
  );
}

/**
 * Help affordances shown under every technical field: plain-language context,
 * an optional "I'm not sure" escape hatch, a "Need help?" panel and a one-tap
 * "Schedule setup call" shortcut. We never make the client feel tested.
 */
function TechAssist({
  field,
  value,
  onChange,
  onScheduleHelp,
  showNotSure = false,
}: {
  field: OnboardingField;
  value?: unknown;
  onChange?: (v: unknown) => void;
  onScheduleHelp?: (label: string) => void;
  showNotSure?: boolean;
}) {
  const [openHelp, setOpenHelp] = useState(false);
  const help = TECHNICAL_FIELD_HELP[field.name];
  const notSure = value === NOT_SURE;
  return (
    <div className="mt-1.5 space-y-2">
      {help && <FieldHelp>{help}</FieldHelp>}
      <div className="flex flex-wrap items-center gap-2">
        {showNotSure && onChange && (
          <button
            type="button"
            onClick={() => onChange(notSure ? "" : NOT_SURE)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              notSure
                ? "border-amber-400 bg-amber-50 text-amber-700"
                : "border-ink-200 text-ink-500 hover:border-ink-300"
            )}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {notSure ? "Marked “Not sure”" : "I'm not sure"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpenHelp((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-500 hover:border-ink-300"
        >
          <Info className="h-3.5 w-3.5" /> Need help?
        </button>
      </div>
      {openHelp && (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-xs text-ink-600">
          <p>
            Not sure where to find this? No problem — choose “I&apos;m not sure”
            and our team will handle it, or book a quick setup call and we&apos;ll
            do it together.
          </p>
          {onScheduleHelp && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onScheduleHelp(field.label)}
            >
              <CalendarClock className="h-4 w-4" /> Schedule setup call
            </Button>
          )}
        </div>
      )}
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
      <FieldLabel field={field} />
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

function GroupList({
  clientId,
  field,
  value,
  onChange,
  readOnly,
}: {
  clientId: string;
  field: OnboardingField;
  value: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
  readOnly: boolean;
}) {
  const subFields = field.subFields ?? [];
  const updateEntry = (idx: number, name: string, v: unknown) => {
    const next = value.map((e, i) => (i === idx ? { ...e, [name]: v } : e));
    onChange(next);
  };
  return (
    <div>
      <FieldLabel field={field} />
      <div className="space-y-3">
        {value.map((entry, idx) => (
          <div key={idx} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-500">
                Entry {idx + 1}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  className="text-ink-400 hover:text-red-500"
                  aria-label="Remove entry"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {subFields.map((sf) => (
                <div
                  key={sf.name}
                  className={cn(FULL_WIDTH_TYPES.has(sf.type) && "sm:col-span-2")}
                >
                  <FieldRenderer
                    clientId={clientId}
                    field={sf}
                    value={entry[sf.name]}
                    onChange={(v) => updateEntry(idx, sf.name, v)}
                    readOnly={readOnly}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => onChange([...value, {}])}
        >
          <Plus className="h-4 w-4" /> Add {field.label.toLowerCase()}
        </Button>
      )}
      {field.help && <FieldHelp>{field.help}</FieldHelp>}
    </div>
  );
}
