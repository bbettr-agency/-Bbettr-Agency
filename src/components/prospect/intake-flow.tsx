"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Send, CheckCircle2, Clock, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntakeShell } from "./intake-shell";
import { SaveStatusPill } from "./intake-fields";
import {
  BusinessSection,
  ServicesSection,
  ServiceDetailPanel,
  GoalsSection,
  BudgetSection,
  ReviewSection,
  SERVICE_LABELS,
} from "./intake-sections";
import { useTurnstile } from "./turnstile-widget";
import { createIntakeDraftAction, saveIntakeDraftAction, submitIntakeAction } from "@/app/start/actions";
import { BUSINESS_FIELDS } from "@/lib/prospect/intake-schema";
import type { IntakeSectionId } from "@/lib/prospect/intake-steps";
import { progressFor } from "@/lib/prospect/intake-steps";
import type { FieldErrors } from "@/lib/prospect/intake-validation";
import {
  advance,
  back,
  editTarget,
  validateSection,
  serviceDetailPanels,
  canCreateDraft,
  canSubmitNow,
  classifyKind,
  isClosedOutcome,
  applySaveResult,
  type SaveStatus,
} from "@/lib/prospect/intake-flow-machine";

const HONEYPOT_FIELD = "secondary_reference";
const BUSINESS_KEYS = BUSINESS_FIELDS.map((f) => f.name);
const AUTOSAVE_MS = 800;

type Data = Record<string, unknown>;
type ClosedKind = "expired" | "closed" | null;

const SECTION_HEADINGS: Record<IntakeSectionId, { title: string; sub?: string }> = {
  business: { title: "Tell us about your business.", sub: "A few basics so we know who we're speaking with." },
  services: { title: "What would you like help with?", sub: "Pick what's relevant — or tell us you're not sure yet." },
  details: { title: "A few details.", sub: "This helps us tailor our recommendation." },
  goals: { title: "What are you hoping to achieve?", sub: "Choose any that apply." },
  budget: { title: "Budget & timing.", sub: "A rough idea is perfectly fine." },
  review: { title: "Quick review.", sub: "Check everything looks right, then send it to us." },
};

export function IntakeFlow({
  mode,
  initialToken,
  initialData,
  initialSection,
}: {
  mode: "generic" | "resume";
  initialToken?: string;
  initialData?: Data;
  initialSection?: IntakeSectionId;
}) {
  const [phase, setPhase] = useState<"intro" | "form" | "success">(mode === "resume" ? "form" : "intro");
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [section, setSection] = useState<IntakeSectionId>(initialSection ?? "business");
  const [panel, setPanel] = useState(0);
  const [data, setDataState] = useState<Data>(initialData ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [closed, setClosed] = useState<ClosedKind>(null);
  const [returnToReview, setReturnToReview] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  const turnstile = useTurnstile();

  // Refs mirror state for use inside async/debounced closures.
  const dataRef = useRef(data);
  const tokenRef = useRef(token);
  const pendingRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous lock: closes the async-state gap so a fast double-click can never
  // fire a second create/submit before React re-renders `creating`/`submitting`.
  const writeLock = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  dataRef.current = data;
  tokenRef.current = token;

  // Move keyboard focus to the section heading on navigation (a11y).
  useEffect(() => {
    if (phase === "form") headingRef.current?.focus();
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  }, [section, panel, phase]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // ── Data updates + autosave ────────────────────────────────────────────────
  const setData = useCallback((next: Data) => {
    dataRef.current = next;
    setDataState(next);
  }, []);

  // Single-flight autosave. The client is the source of truth for the live edit
  // session (we never reconcile the server's normalized copy back onto the inputs
  // — that would erase a partially-typed optional value like a not-yet-valid URL);
  // the server is canonical at rest and on submit. On failure the edits stay
  // pending so a retry/flush re-sends them and advance stays blocked.
  const performSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return savingRef.current; // one save in flight at a time
    if (!tokenRef.current || !pendingRef.current) return true;
    pendingRef.current = false;
    setSaveStatus("saving");
    const snapshot = { ...dataRef.current };
    delete snapshot[HONEYPOT_FIELD];
    const run = (async (): Promise<boolean> => {
      try {
        const res = await saveIntakeDraftAction(tokenRef.current as string, snapshot);
        const t = applySaveResult(res.kind);
        if (t.stillPending) pendingRef.current = true; // keep dirty → retryable, blocks advance
        if (t.closed) setClosed(t.closed);
        setSaveStatus(t.status);
        return t.ok;
      } catch {
        pendingRef.current = true; // network error → still unsaved
        setSaveStatus("error");
        return false;
      } finally {
        savingRef.current = null;
      }
    })();
    savingRef.current = run;
    return run;
  }, []);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void performSave(), AUTOSAVE_MS);
  }, [performSave]);

  // Confirmed save before advancing: wait out any in-flight save, then flush a
  // catch-up save for edits that landed while it ran. Bounded (≤2 round trips).
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    let ok = await performSave();
    if (ok && pendingRef.current) ok = await performSave();
    return ok;
  }, [performSave]);

  const update = useCallback(
    (patch: Data) => {
      const next = { ...dataRef.current, ...patch };
      setData(next);
      pendingRef.current = true;
      // Clear inline errors for the fields being edited.
      setErrors((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        const copy = { ...prev };
        for (const k of Object.keys(patch)) delete copy[k];
        return copy;
      });
      if (tokenRef.current) scheduleSave();
    },
    [scheduleSave, setData]
  );

  // ── Create (after Business) ──────────────────────────────────────────────────
  const doCreate = useCallback(async () => {
    if (writeLock.current || !canCreateDraft({ creating, token })) return; // guard double-click / re-create
    const v = validateSection("business", dataRef.current);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    writeLock.current = true;
    setErrors({});
    setNote(null);
    setCreating(true);
    const d = dataRef.current;
    const input: Record<string, unknown> = { honeypot, turnstileToken: turnstile.token };
    for (const k of BUSINESS_KEYS) input[k] = d[k];
    try {
      const res = await createIntakeDraftAction(input);
      if (res.kind === "success") {
        setToken(res.token);
        tokenRef.current = res.token;
        if (typeof window !== "undefined") {
          window.history.replaceState(window.history.state, "", `/start/${res.token}`);
        }
        turnstile.reset(); // fresh token available for the later submit
        setCreating(false);
        setSaveStatus("saved");
        setSection("services");
        setPanel(0);
        return;
      }
      setCreating(false);
      if (res.kind === "validation_error") setErrors(res.errors ?? {});
      else if (res.kind === "verification_failed" || res.kind === "configuration_error") {
        turnstile.reset();
        setNote("We couldn't verify your browser just now. Please try again in a moment.");
      } else {
        setNote("Something went wrong saving your details. Please try again.");
      }
    } catch {
      setCreating(false);
      setNote("Something went wrong. Please check your connection and try again.");
    } finally {
      writeLock.current = false;
    }
  }, [creating, token, honeypot, turnstile]);

  // ── Submit (from Review) ─────────────────────────────────────────────────────
  const doSubmit = useCallback(async () => {
    if (writeLock.current || !canSubmitNow({ submitting, token })) return; // guard double-submit
    writeLock.current = true;
    const ok = await flushSave(); // persist any last edits first
    if (!ok) {
      writeLock.current = false;
      return;
    }
    const v = validateSection("review", dataRef.current);
    if (!v.ok) {
      writeLock.current = false;
      setErrors(v.errors);
      setNote("Please double-check the highlighted details.");
      return;
    }
    setNote(null);
    setSubmitting(true);
    try {
      const res = await submitIntakeAction({
        rawToken: token as string,
        turnstileToken: turnstile.token,
        honeypot,
      });
      const outcome = classifyKind(res.kind);
      if (res.kind === "success" || res.kind === "already_submitted") {
        setSubmitting(false);
        setPhase("success");
        return;
      }
      setSubmitting(false);
      if (isClosedOutcome(outcome)) {
        setClosed(outcome === "expired" ? "expired" : "closed");
      } else if (outcome === "verification" || outcome === "config") {
        turnstile.reset();
        setNote("We couldn't verify your browser just now. Please try sending again.");
      } else if (outcome === "conflict") {
        setNote("That didn't go through — please tap Send once more.");
      } else if (outcome === "validation") {
        setErrors((res as { errors?: FieldErrors }).errors ?? {});
        setNote("Please double-check the highlighted details.");
      } else {
        setNote("Something went wrong sending your details. Please try again.");
      }
    } catch {
      setSubmitting(false);
      setNote("Something went wrong. Please check your connection and try again.");
    } finally {
      // On success we stay locked implicitly (phase → success unmounts the form);
      // releasing here is still safe because canSubmitNow re-gates on state.
      writeLock.current = false;
    }
  }, [submitting, token, flushSave, turnstile, honeypot]);

  // ── Navigation ────────────────────────────────────────────────────────────────
  const goBack = useCallback(() => {
    setNote(null);
    setErrors({});
    if (returnToReview) {
      setReturnToReview(false);
      setSection("review");
      setPanel(0);
      return;
    }
    const b = back(section, panel, dataRef.current);
    if (!b) {
      if (mode === "generic" && !token) setPhase("intro");
      return;
    }
    setSection(b.section);
    setPanel(b.panel);
  }, [section, panel, returnToReview, mode, token]);

  const goForward = useCallback(async () => {
    setNote(null);

    // Create and submit own their own validation (and surface their own notes).
    if (section === "business" && !token) {
      await doCreate();
      return;
    }
    if (section === "review") {
      await doSubmit();
      return;
    }

    const v = validateSection(section, dataRef.current);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});

    const ok = await flushSave(); // confirmed save before advancing
    if (!ok) return;

    // Returning from a Review "Edit": go back to Review (finishing Details panels first).
    if (returnToReview) {
      if (section === "details" && panel < serviceDetailPanels(dataRef.current).length - 1) {
        setPanel(panel + 1);
        return;
      }
      setReturnToReview(false);
      setSection("review");
      setPanel(0);
      return;
    }

    const nav = advance(section, panel, dataRef.current);
    setSection(nav.section);
    setPanel(nav.panel);
  }, [section, panel, token, returnToReview, doCreate, doSubmit, flushSave]);

  const onEdit = useCallback((target: IntakeSectionId) => {
    setReturnToReview(true);
    setNote(null);
    setErrors({});
    const t = editTarget(target);
    setSection(t.section);
    setPanel(t.panel);
  }, []);

  // ── Closed / success terminal views ──────────────────────────────────────────
  if (closed) return <ClosedView kind={closed} />;
  if (phase === "success") return <SuccessView />;

  // ── Intro ──────────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <IntakeShell>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Get started</p>
        <h1 className="mt-3 font-display text-[2rem] font-bold leading-[1.1] text-ink-900 sm:text-4xl lg:mt-4 lg:text-5xl">
          Tell us about your business.
        </h1>
        <p className="mt-4 max-w-[34rem] text-base leading-relaxed text-ink-500 lg:mt-5 lg:text-lg">
          Answer a few quick questions and we&rsquo;ll recommend the best next step.
        </p>
        <div className="mt-8 lg:mt-10">
          <Button size="lg" onClick={() => setPhase("form")} className="w-full sm:w-auto">
            Get started
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-5 text-xs text-ink-400 lg:mt-6">
          Takes about 3 minutes ·{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-600">
            How we use your details
          </Link>
        </p>
      </IntakeShell>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────────
  const heading = SECTION_HEADINGS[section];
  const panels = serviceDetailPanels(dataRef.current);
  const activeService = section === "details" ? panels[Math.min(panel, panels.length - 1)] : undefined;
  const busy = creating || submitting;
  const primaryLabel = section === "review" ? "Send to Bbettr" : "Continue";
  const canGoBack = returnToReview || !!back(section, panel, dataRef.current) || (mode === "generic" && !token);

  return (
    <IntakeShell progress={progressFor(section)}>
      {canGoBack && (
        <button
          type="button"
          onClick={goBack}
          disabled={busy}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-800 disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" /> {returnToReview ? "Back to review" : "Back"}
        </button>
      )}

      <div key={`${section}:${panel}`} className="motion-safe:animate-fade-in">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl font-bold text-ink-900 outline-none sm:text-3xl"
        >
          {heading.title}
        </h2>
        {heading.sub && <p className="mt-3 text-base leading-relaxed text-ink-500">{heading.sub}</p>}

        {section === "details" && panels.length > 1 && activeService && (
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-brand-600">
            {SERVICE_LABELS[activeService]} · {panel + 1} of {panels.length} services
          </p>
        )}

        <div className="mt-7">
          {section === "business" && (
            <BusinessSection data={data} errors={errors} update={update} onBlurSave={() => token && flushSave()} />
          )}
          {section === "services" && <ServicesSection data={data} errors={errors} update={update} />}
          {section === "details" && activeService && (
            <ServiceDetailPanel
              service={activeService}
              data={data}
              errors={errors}
              update={update}
              onBlurSave={() => token && flushSave()}
            />
          )}
          {section === "goals" && (
            <GoalsSection data={data} errors={errors} update={update} onBlurSave={() => token && flushSave()} />
          )}
          {section === "budget" && <BudgetSection data={data} errors={errors} update={update} />}
          {section === "review" && <ReviewSection data={data} onEdit={onEdit} />}
        </div>
      </div>

      {note && (
        <p role="status" className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {note}
        </p>
      )}

      <div className="mt-9 flex items-center justify-between gap-4">
        <div className="min-w-0">{token && <SaveStatusPill status={saveStatus} />}</div>
        <Button
          size="lg"
          onClick={goForward}
          loading={busy}
          disabled={busy}
          className="shrink-0"
        >
          {section === "review" ? (
            <>
              <Send className="h-4 w-4" /> {primaryLabel}
            </>
          ) : (
            <>
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {/* Honeypot — off-screen, not autofillable, ignored by real users. */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Do not fill this in</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {/* Managed Turnstile (unobtrusive); server always re-verifies. */}
      {turnstile.widget}
    </IntakeShell>
  );
}

// ── Terminal views ───────────────────────────────────────────────────────────
function SuccessView() {
  return (
    <IntakeShell>
      <div className="flex items-center gap-2 text-emerald-600">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-semibold">Received</span>
      </div>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">Thanks — we&rsquo;ve got it.</h1>
      <p className="mt-3 text-base leading-relaxed text-ink-500">
        We&rsquo;ll review your details and get back to you shortly.
      </p>
      <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-ink-900">What happens next</p>
        <ol className="mt-3 grid gap-2.5 text-sm text-ink-600">
          <li className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">1</span>
            We review what you&rsquo;ve shared.
          </li>
          <li className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">2</span>
            Someone from Bbettr will contact you to discuss the best next step.
          </li>
        </ol>
      </div>
      <p className="mt-6 text-sm text-ink-500">
        Questions?{" "}
        <a href="mailto:info@bbettragency.com" className="font-medium text-brand-600 hover:text-brand-700">
          info@bbettragency.com
        </a>
      </p>
    </IntakeShell>
  );
}

function ClosedView({ kind }: { kind: "expired" | "closed" }) {
  const expired = kind === "expired";
  return (
    <IntakeShell>
      <div className="flex items-center gap-2 text-ink-400">
        {expired ? <Clock className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
        <span className="text-sm font-semibold">{expired ? "Link expired" : "Link unavailable"}</span>
      </div>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">
        {expired ? "This link has expired." : "This link is no longer active."}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-500">
        {expired ? "You can start a new one at any time." : "You can start a new one, or reach us any time."}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button asChild size="lg">
          <Link href="/start">
            Start a new one <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <a href="mailto:info@bbettragency.com" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          info@bbettragency.com
        </a>
      </div>
    </IntakeShell>
  );
}
